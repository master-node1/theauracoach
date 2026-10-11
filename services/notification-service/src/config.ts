import { baseEnvSchema, loadConfig } from '@aura/service-kit';

/** notification-service has no settings beyond the shared ones yet. Extend the schema here when it does. */
export const configSchema = baseEnvSchema;
export type ServiceConfig = ReturnType<typeof configSchema.parse>;

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return loadConfig(configSchema, env);
}
