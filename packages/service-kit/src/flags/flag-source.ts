import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { flagDocumentSchema, type FlagDocument } from '@aura/contracts';

/** Where the flag document lives. `load` returns undefined when nothing changed since last time. */
export interface FlagSource {
  readonly name: string;
  load(): Promise<FlagDocument | undefined>;
  /** Only local and dev sources are writable; AppConfig changes go through Terraform or the console. */
  write?(doc: FlagDocument): Promise<void>;
}

const EMPTY: FlagDocument = { flags: {} };

/** No document: flags are the catalogue defaults with FEATURE_<KEY> env overrides. */
export class EnvFlagSource implements FlagSource {
  readonly name = 'env';
  async load(): Promise<FlagDocument> {
    return EMPTY;
  }
}

/**
 * A JSON flag document on disk (local and dev). A missing file means "no rules"; an invalid one
 * throws, so the last good document stays in use. Writes replace the file atomically.
 */
export class FileFlagSource implements FlagSource {
  readonly name = 'file';
  constructor(private readonly path: string) {}

  async load(): Promise<FlagDocument> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
      throw err;
    }
    return flagDocumentSchema.parse(JSON.parse(text));
  }

  async write(doc: FlagDocument): Promise<void> {
    const tmp = join(dirname(this.path), `.flags-${process.pid}-${Date.now()}.json`);
    await writeFile(tmp, `${JSON.stringify(flagDocumentSchema.parse(doc), null, 2)}\n`);
    await rename(tmp, this.path);
  }
}

/** The two AppConfig Data calls we use, so tests can stand in for the AWS SDK client. */
export interface AppConfigDataApi {
  startSession(input: {
    application: string;
    environment: string;
    profile: string;
    minPollSeconds: number;
  }): Promise<string>;
  latest(token: string): Promise<{ configuration?: Uint8Array; nextToken: string }>;
}

/**
 * AWS AppConfig Data (freeform JSON profile, validated against `flagDocumentSchema`). A session
 * token is good for one call; the next one comes back with each answer. An empty configuration
 * means the deployed version has not changed. On any error the session starts again next poll.
 */
export class AppConfigFlagSource implements FlagSource {
  readonly name = 'appconfig';
  private token: string | undefined;

  constructor(
    private readonly api: AppConfigDataApi,
    private readonly target: { application: string; environment: string; profile: string },
    private readonly minPollSeconds: number,
  ) {}

  async load(): Promise<FlagDocument | undefined> {
    try {
      this.token ??= await this.api.startSession({
        ...this.target,
        minPollSeconds: this.minPollSeconds,
      });
      const { configuration, nextToken } = await this.api.latest(this.token);
      this.token = nextToken;
      if (!configuration || configuration.length === 0) return undefined;
      return flagDocumentSchema.parse(JSON.parse(new TextDecoder().decode(configuration)));
    } catch (err) {
      this.token = undefined;
      throw err;
    }
  }
}

/** AppConfig Data through the AWS SDK, with the default credential chain (the pod's IAM role). */
export async function sdkAppConfigDataApi(): Promise<AppConfigDataApi> {
  const sdk = await import('@aws-sdk/client-appconfigdata');
  const client = new sdk.AppConfigDataClient({});
  return {
    async startSession(input) {
      const out = await client.send(
        new sdk.StartConfigurationSessionCommand({
          ApplicationIdentifier: input.application,
          EnvironmentIdentifier: input.environment,
          ConfigurationProfileIdentifier: input.profile,
          RequiredMinimumPollIntervalInSeconds: Math.max(15, input.minPollSeconds),
        }),
      );
      if (!out.InitialConfigurationToken) throw new Error('AppConfig returned no session token');
      return out.InitialConfigurationToken;
    },
    async latest(token) {
      const out = await client.send(
        new sdk.GetLatestConfigurationCommand({ ConfigurationToken: token }),
      );
      if (!out.NextPollConfigurationToken) throw new Error('AppConfig returned no next token');
      return {
        ...(out.Configuration ? { configuration: out.Configuration } : {}),
        nextToken: out.NextPollConfigurationToken,
      };
    },
  };
}
