import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  envFlagDefaults,
  evaluateFlags,
  type FlagDocument,
  type FlagKey,
  type FlagRule,
  type FlagValues,
} from '@aura/contracts';
import { ConfigError, type BaseConfig } from '../config/config';
import {
  AppConfigFlagSource,
  EnvFlagSource,
  FileFlagSource,
  sdkAppConfigDataApi,
  type AppConfigDataApi,
  type FlagSource,
} from './flag-source';

/**
 * The feature flag port. Inject it wherever behaviour depends on a flag; tests bind
 * `StaticFeatureFlags`. Every service evaluates the same document, so a flag means the same
 * thing in every service and in the apps (which read `GET /v1/me/flags`).
 */
export abstract class FeatureFlags {
  abstract evaluate(userId?: string): FlagValues;
  abstract document(): FlagDocument;
  /** True when this source accepts `setRule` (local and dev flag files). */
  abstract readonly writable: boolean;
  abstract setRule(key: FlagKey, rule: FlagRule | null): Promise<void>;

  isEnabled(key: FlagKey, userId?: string): boolean {
    return this.evaluate(userId)[key];
  }
}

export class FlagsReadOnlyError extends Error {}

/**
 * Loads the flag document at start-up and re-reads it every poll interval, keeping the last good
 * document when a read fails. Evaluation is in memory, so checking a flag costs nothing.
 */
export class PollingFeatureFlags extends FeatureFlags implements OnModuleDestroy {
  private readonly logger = new Logger('FeatureFlags');
  private doc: FlagDocument = { flags: {} };
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly source: FlagSource,
    private readonly defaults: FlagValues,
    private readonly pollMs: number,
  ) {
    super();
  }

  get writable(): boolean {
    return typeof this.source.write === 'function';
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.pollMs);
    this.timer.unref();
  }

  async refresh(): Promise<void> {
    try {
      const next = await this.source.load();
      if (next) this.doc = next;
    } catch (err) {
      this.logger.warn(
        { source: this.source.name, err: (err as Error).message },
        'Could not read feature flags; keeping the last good set',
      );
    }
  }

  evaluate(userId?: string): FlagValues {
    return evaluateFlags(this.doc, userId, this.defaults);
  }

  document(): FlagDocument {
    return structuredClone(this.doc);
  }

  /** Sets (or with null, removes) one flag's rule and applies it to this replica at once. */
  async setRule(key: FlagKey, rule: FlagRule | null): Promise<void> {
    if (!this.source.write) throw new FlagsReadOnlyError(`${this.source.name} flags are read-only`);
    const current = (await this.source.load()) ?? this.doc;
    const flags = { ...current.flags };
    if (rule) flags[key] = rule;
    else delete flags[key];
    await this.source.write({ flags });
    this.doc = { flags };
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Fixed flags for tests. */
export class StaticFeatureFlags extends FeatureFlags {
  readonly writable = true;
  constructor(private doc: FlagDocument = { flags: {} }) {
    super();
  }

  evaluate(userId?: string): FlagValues {
    return evaluateFlags(this.doc, userId);
  }

  document(): FlagDocument {
    return structuredClone(this.doc);
  }

  async setRule(key: FlagKey, rule: FlagRule | null): Promise<void> {
    const flags = { ...this.doc.flags };
    if (rule) flags[key] = rule;
    else delete flags[key];
    this.doc = { flags };
  }
}

/** Builds the flag source the config names and loads it once. */
export async function createFeatureFlags(
  config: BaseConfig,
  env: NodeJS.ProcessEnv = process.env,
  appConfigApi?: AppConfigDataApi,
): Promise<PollingFeatureFlags> {
  const flags = new PollingFeatureFlags(
    await flagSource(config, appConfigApi),
    envFlagDefaults(env),
    config.FLAGS_POLL_SECONDS * 1000,
  );
  await flags.start();
  return flags;
}

async function flagSource(config: BaseConfig, api?: AppConfigDataApi): Promise<FlagSource> {
  switch (config.FLAGS_SOURCE) {
    case 'env':
      return new EnvFlagSource();
    case 'file':
      if (!config.FLAGS_FILE) throw new ConfigError('FLAGS_FILE: required when FLAGS_SOURCE=file');
      return new FileFlagSource(config.FLAGS_FILE);
    case 'appconfig': {
      const { APPCONFIG_APPLICATION, APPCONFIG_ENVIRONMENT, APPCONFIG_PROFILE } = config;
      if (!APPCONFIG_APPLICATION || !APPCONFIG_ENVIRONMENT || !APPCONFIG_PROFILE) {
        throw new ConfigError(
          'APPCONFIG_APPLICATION, APPCONFIG_ENVIRONMENT, APPCONFIG_PROFILE: required when FLAGS_SOURCE=appconfig',
        );
      }
      return new AppConfigFlagSource(
        api ?? (await sdkAppConfigDataApi()),
        {
          application: APPCONFIG_APPLICATION,
          environment: APPCONFIG_ENVIRONMENT,
          profile: APPCONFIG_PROFILE,
        },
        config.FLAGS_POLL_SECONDS,
      );
    }
  }
}
