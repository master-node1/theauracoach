import { SERVICE_NAMES } from '@aura/contracts';
import { z } from 'zod';

const csv = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string()).min(1));

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Environment every service needs. Values come from ConfigMaps and External Secrets, never from code. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.enum(SERVICE_NAMES),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  /** Cognito user pool JWKS, e.g. https://cognito-idp.ap-south-1.amazonaws.com/<pool>/.well-known/jwks.json */
  AUTH_JWKS_URL: z.url(),
  /** Cognito issuer, e.g. https://cognito-idp.ap-south-1.amazonaws.com/<pool> */
  AUTH_ISSUER: z.string().min(1),
  /** App client ids whose access tokens are accepted (web BFF, mobile). */
  AUTH_CLIENT_IDS: csv,
  /** HMAC key for service-to-service tokens. At least 32 characters. */
  INTERNAL_TOKEN_SECRET: z.string().min(32),
  /** Base URLs of other services this one may call, as `name=url` pairs. */
  INTERNAL_SERVICE_URLS: z.string().default(''),

  /**
   * Where feature flags come from (platform LLD §11): `env` (FEATURE_<KEY> variables only),
   * `file` (a JSON flag document at FLAGS_FILE, local and dev) or `appconfig` (AWS AppConfig).
   */
  FLAGS_SOURCE: z.enum(['env', 'file', 'appconfig']).default('env'),
  FLAGS_FILE: z.string().min(1).optional(),
  /** How often the flag document is re-read. AppConfig allows 15 s at the least. */
  FLAGS_POLL_SECONDS: z.coerce.number().int().min(1).max(3600).default(45),
  APPCONFIG_APPLICATION: z.string().min(1).optional(),
  APPCONFIG_ENVIRONMENT: z.string().min(1).optional(),
  APPCONFIG_PROFILE: z.string().min(1).optional(),

  /** Per-user and per-IP API limits (security architecture §5). Off only in load tests. */
  RATE_LIMIT_ENABLED: bool.default(true),
  RATE_LIMIT_USER_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_IP_PER_MINUTE: z.coerce.number().int().min(1).default(1000),
});

export type BaseConfig = z.infer<typeof baseEnvSchema>;

export class ConfigError extends Error {}

/**
 * Validates the environment once at start-up and fails fast.
 * Error messages name the variables and problems, never their values.
 */
export function loadConfig<S extends z.ZodType<BaseConfig>>(
  schema: S = baseEnvSchema as unknown as S,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new ConfigError(`Invalid environment:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}

/** Parses `profile-service=http://profile:3000,coach-service=http://coach:3000`. */
export function parseServiceUrls(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [name, url] = pair.split('=');
    if (!name || !url) throw new ConfigError(`INTERNAL_SERVICE_URLS: bad entry "${name ?? ''}"`);
    out[name.trim()] = url.trim().replace(/\/$/, '');
  }
  return out;
}
