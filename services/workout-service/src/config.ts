import { baseEnvSchema, loadConfig } from '@aura/service-kit';
import { z } from 'zod';

export const configSchema = baseEnvSchema.extend({
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
