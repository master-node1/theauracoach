import { baseEnvSchema, loadConfig, objectStorageEnvSchema } from '@aura/service-kit';
import { z } from 'zod';

/** Shared settings plus object storage, where this service writes its part of data exports. */
export const configSchema = baseEnvSchema.extend({
  ...objectStorageEnvSchema.shape,
  /**
   * Public base URL of the exercise media bucket (CloudFront), e.g. https://media.example.com.
   * Unset (or empty) until licensed media exists; media keys are then returned unchanged.
   */
  MEDIA_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url().optional()),
});
export type ServiceConfig = ReturnType<typeof configSchema.parse>;

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return loadConfig(configSchema, env);
}
