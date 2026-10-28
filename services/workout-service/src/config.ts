import { baseEnvSchema, loadConfig, objectStorageEnvSchema } from '@aura/service-kit';

/** Shared settings plus object storage, where this service writes its part of data exports. */
export const configSchema = baseEnvSchema.extend(objectStorageEnvSchema.shape);
export type ServiceConfig = ReturnType<typeof configSchema.parse>;

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return loadConfig(configSchema, env);
}
