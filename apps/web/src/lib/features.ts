import { envFlagDefaults, type FlagValues } from '@aura/api-client';

/**
 * Flag values to use when `GET /v1/me/flags` cannot answer (signed out, API down): the catalogue
 * defaults with `FEATURE_<KEY>` environment overrides, e.g. `FEATURE_SETTINGS_V1=false`.
 * Signed-in pages read the evaluated flags with `currentFlags()` (server-session.ts).
 */
export function flagDefaults(env: Record<string, string | undefined> = process.env): FlagValues {
  return envFlagDefaults(env);
}
