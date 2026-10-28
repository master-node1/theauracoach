import { baseEnvSchema, loadConfig } from '@aura/service-kit';
import { z } from 'zod';

/** Local dev-auth speaks the same identity API as Cognito. */
export const DEV_IDENTITY_ENDPOINT = 'http://localhost:4100/';

export const configSchema = baseEnvSchema
  .extend({
    /**
     * Cognito's user API, e.g. https://cognito-idp.ap-south-1.amazonaws.com/ (dev-auth locally).
     * Role grants mirror to Cognito groups through it.
     */
    IDENTITY_ENDPOINT: z.url().optional(),
    /** The user pool whose groups mirror role grants. dev-auth ignores it. */
    COGNITO_USER_POOL_ID: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).default('ap-south-1'),
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
