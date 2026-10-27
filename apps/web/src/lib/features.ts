/**
 * Feature flags for unfinished slices. Read from the environment until AWS AppConfig is wired up
 * with the hosting work (TAC-4); every flag is on unless set to "false" or "0".
 */
export function featureEnabled(
  name: 'SETTINGS_V1',
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env[`FEATURE_${name}`];
  return value !== 'false' && value !== '0';
}
