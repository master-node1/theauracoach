import type { CoachTone, ConsentPurpose, Theme } from '@aura/contracts';

/**
 * Settings copy and choices shared by the web and mobile Settings screens (W13 in
 * docs/ux/hifi-designs.md), so both apps offer the same options with the same words.
 */

/** Optional consents users can switch on and off. CORE_SERVICE is required and not listed. */
export const SETTINGS_CONSENTS: readonly {
  purpose: ConsentPurpose;
  label: string;
  description: string;
}[] = [
  {
    purpose: 'AI_COACH',
    label: 'AI coach',
    description: 'Lets the coach read your plan and logs to answer questions and suggest changes.',
  },
  {
    purpose: 'NOTIFICATIONS',
    label: 'Reminders',
    description: 'Workout and meal reminders and a weekly summary.',
  },
  {
    purpose: 'MARKETING',
    label: 'Product news',
    description: 'Occasional emails about new features.',
  },
];

export const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export const COACH_TONE_OPTIONS: readonly { value: CoachTone; label: string }[] = [
  { value: 'supportive', label: 'Supportive' },
  { value: 'direct', label: 'Direct' },
];

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
  for (const { purpose } of SETTINGS_CONSENTS) state[purpose] = false;
  for (const c of consents) state[c.purpose] = c.granted;
  return state;
}
