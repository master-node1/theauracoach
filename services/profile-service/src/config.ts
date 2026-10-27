import { baseEnvSchema, loadConfig } from '@aura/service-kit';
import { z } from 'zod';

/** Local dev-auth speaks the same identity API as Cognito (TAC-8). */
export const DEV_IDENTITY_ENDPOINT = 'http://localhost:4100/';

export const configSchema = baseEnvSchema
  .extend({
    /**
     * Cognito's user API, e.g. https://cognito-idp.ap-south-1.amazonaws.com/ (dev-auth locally).
     * Used for GlobalSignOut when a user signs out of all devices.
     */
    IDENTITY_ENDPOINT: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.IDENTITY_ENDPOINT) {
      ctx.addIssue({
        code: 'custom',
        path: ['IDENTITY_ENDPOINT'],
        message: 'Required in production',
      });
    }
  });
export type ServiceConfig = z.infer<typeof configSchema>;

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return loadConfig(configSchema, env);
}
