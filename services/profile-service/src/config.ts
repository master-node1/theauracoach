import { ConfigError, baseEnvSchema, loadConfig, objectStorageEnvSchema } from '@aura/service-kit';
import { z } from 'zod';

/**
 * Shared settings, object storage, and the export and deletion timings (users LLD §3–4). The
 * timings are settings so tests and staging can shorten them; production uses the defaults.
 */
export const configSchema = baseEnvSchema.extend(objectStorageEnvSchema.shape).extend({
  /** Days between DELETE /v1/me and the hard delete; the user can restore within them. */
  DELETION_GRACE_DAYS: z.coerce.number().min(0).default(30),
  /** DELETE /v1/me needs a sign-in no older than this (token `auth_time`). */
  REAUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(30).default(300),
  /** Lifetime of an export download link. */
  EXPORT_LINK_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  /** Days an export file is kept. */
  EXPORT_RETENTION_DAYS: z.coerce.number().min(0).default(7),
  /** An export whose parts have not all arrived after this long is marked failed. */
  EXPORT_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(60),
  /** Alert when a service has not confirmed a purge after this long (service catalog §6.3). */
  PURGE_ACK_ALERT_HOURS: z.coerce.number().min(0).default(24),
  /** How often the worker runs the retention, expiry and alert jobs. */
  PRIVACY_JOB_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(900),
  /** Who deletes the sign-in identity: Cognito in AWS, dev-auth locally, nobody in unit tests. */
  IDENTITY_ADMIN: z.enum(['cognito', 'dev-auth', 'none']).default('dev-auth'),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  DEV_AUTH_URL: z.url().default('http://localhost:4100'),
});
export type ServiceConfig = ReturnType<typeof configSchema.parse>;

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const config = loadConfig(configSchema, env);
  if (config.NODE_ENV === 'production' && config.IDENTITY_ADMIN !== 'cognito') {
    throw new ConfigError('IDENTITY_ADMIN must be cognito in production');
  }
  if (config.IDENTITY_ADMIN === 'cognito' && !config.COGNITO_USER_POOL_ID) {
    throw new ConfigError('COGNITO_USER_POOL_ID is required when IDENTITY_ADMIN=cognito');
  }
  return config;
}
