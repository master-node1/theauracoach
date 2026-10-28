import { baseEnvSchema, loadConfig, objectStorageEnvSchema } from '@aura/service-kit';
import { z } from 'zod';

/** Local dev-auth speaks the same identity API as Cognito. */
export const DEV_IDENTITY_ENDPOINT = 'http://localhost:4100/';

/**
 * Shared settings, the identity provider, object storage, and the export and deletion timings
 * (users LLD §3–4). The timings are settings so tests and staging can shorten them; production
 * uses the defaults.
 */
export const configSchema = baseEnvSchema
  .extend(objectStorageEnvSchema.shape)
  .extend({
    /**
     * Cognito's user API, e.g. https://cognito-idp.ap-south-1.amazonaws.com/ (dev-auth locally).
     * Role grants mirror to Cognito groups through it; sign out of all devices calls GlobalSignOut;
     * account deletion calls AdminDeleteUser.
     */
    IDENTITY_ENDPOINT: z.url().optional(),
    /** The user pool whose groups mirror role grants. dev-auth ignores it. */
    COGNITO_USER_POOL_ID: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).default('ap-south-1'),
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
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['IDENTITY_ENDPOINT', 'COGNITO_USER_POOL_ID'] as const) {
      if (!env[key])
        ctx.addIssue({ code: 'custom', path: [key], message: 'Required in production' });
    }
  });
export type ServiceConfig = z.infer<typeof configSchema>;

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return loadConfig(configSchema, env);
}
