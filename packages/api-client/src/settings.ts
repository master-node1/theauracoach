import type { CoachTone, ConsentPurpose, Theme } from '@aura/contracts';

/**
 * Settings choices shared by the web and mobile Settings screens (W13 in
 * docs/ux/hifi-designs.md), so both apps offer the same options. Their labels live in the
 * packages/i18n catalogue under `settings.*`.
 */

/** Optional consents users can switch on and off. CORE_SERVICE is required and not listed. */
export const SETTINGS_CONSENTS = [
  'AI_COACH',
  'NOTIFICATIONS',
  'MARKETING',
] as const satisfies readonly ConsentPurpose[];
export type SettingsConsent = (typeof SETTINGS_CONSENTS)[number];

export const THEME_OPTIONS: readonly Theme[] = ['system', 'light', 'dark'];

export const COACH_TONE_OPTIONS: readonly CoachTone[] = ['supportive', 'direct'];

/** Time zones offered in Settings; the user's current zone is added if it is not listed. */
export const COMMON_TIME_ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;

export function timeZoneOptions(current: string): string[] {
  const zones: string[] = [...COMMON_TIME_ZONES];
  return zones.includes(current) ? zones : [current, ...zones];
}

/** Current state of each listed consent: the latest recorded answer, otherwise off. */
export function consentState(
  consents: readonly { purpose: ConsentPurpose; granted: boolean }[],
): Record<ConsentPurpose, boolean> {
  const state = {} as Record<ConsentPurpose, boolean>;
  for (const purpose of SETTINGS_CONSENTS) state[purpose] = false;
  for (const c of consents) state[c.purpose] = c.granted;
  return state;
}
