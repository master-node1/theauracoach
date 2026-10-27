import { z } from 'zod';

/**
 * Feature flag catalogue (platform LLD §11). Every Phase 5 slice ships behind one of these.
 * Services evaluate flags from one flag document (AWS AppConfig when deployed, a JSON file
 * locally); the apps read the evaluated result from `GET /v1/me/flags`.
 */
export const FEATURE_FLAGS = {
  settings_v1: { default: true, description: 'Settings screen (profile, preferences, consents)' },
  privacy_v1: { default: true, description: 'Data export and account deletion' },
  onboarding_v1: { default: true, description: 'Onboarding, safety screening and plan reveal' },
  workouts_v1: { default: true, description: 'Workout plans, Train and active sessions' },
  nutrition_v1: { default: true, description: 'Food search, meal logging and Eat' },
  coach_v1: { default: true, description: 'AI coach chat' },
  coach_enabled: {
    default: true,
    description: 'Coach kill switch, turned off when the global AI budget runs out',
  },
  progress_v1: { default: true, description: 'Progress, check-ins and trends' },
  notifications_v1: { default: true, description: 'Reminders, inbox and push' },
  meal_plans_v1: { default: true, description: 'Meal plans, recipes and grocery list' },
  barcode_v1: { default: true, description: 'Barcode scanning in food logging' },
} as const satisfies Record<string, { default: boolean; description: string }>;

export type FlagKey = keyof typeof FEATURE_FLAGS;
export const FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FlagKey[];

/** Evaluated flags for one caller, as `GET /v1/me/flags` returns them. */
export type FlagValues = Record<FlagKey, boolean>;
export interface FlagsResponse {
  flags: FlagValues;
}

export function isFlagKey(value: string): value is FlagKey {
  return Object.hasOwn(FEATURE_FLAGS, value);
}

/** One flag's rule. With `rolloutPercent`, `enabled: true` applies to that share of users only. */
export const flagRuleSchema = z.strictObject({
  enabled: z.boolean(),
  /** 0–100, in steps of 0.01. A user's bucket depends only on the flag key and the user id. */
  rolloutPercent: z.number().min(0).max(100).optional(),
  /** Per-user overrides by user id; they win over `enabled` and `rolloutPercent`. */
  users: z.record(z.uuid(), z.boolean()).optional(),
});
export type FlagRule = z.infer<typeof flagRuleSchema>;

/**
 * The flag document, stored as a freeform JSON configuration profile in AppConfig or as a local
 * file. Unknown keys are kept out by the schema so a typo fails validation instead of silently
 * doing nothing.
 */
export const flagDocumentSchema = z.strictObject({
  flags: z.partialRecord(z.enum(FLAG_KEYS as [FlagKey, ...FlagKey[]]), flagRuleSchema),
});
export type FlagDocument = z.infer<typeof flagDocumentSchema>;

/** Body of `PUT /v1/admin/flags/{key}` (local and dev flag files only). */
export const flagRuleUpdateSchema = flagRuleSchema;

/**
 * Deterministic bucket in [0, 10000) for a user and flag, so a staged rollout keeps the same users
 * as the percentage grows. FNV-1a (32-bit) gives the same answer in Node, browsers and Hermes.
 */
export function rolloutBucket(key: string, userId: string): number {
  let hash = 0x811c9dc5;
  const input = `${key}:${userId}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10000;
}

/**
 * Evaluates every flag for a caller. `defaults` fill in flags the document does not mention
 * (catalogue defaults, or env overrides of them). Without a user id, percentage rollouts are off.
 */
export function evaluateFlags(
  doc: FlagDocument,
  userId: string | undefined,
  defaults: FlagValues = catalogueDefaults(),
): FlagValues {
  const out = { ...defaults };
  for (const key of FLAG_KEYS) {
    const rule = doc.flags[key];
    if (rule) out[key] = evaluateRule(key, rule, userId);
  }
  return out;
}

function evaluateRule(key: FlagKey, rule: FlagRule, userId: string | undefined): boolean {
  const override = userId ? rule.users?.[userId] : undefined;
  if (override !== undefined) return override;
  if (!rule.enabled) return false;
  if (rule.rolloutPercent === undefined || rule.rolloutPercent >= 100) return true;
  if (!userId) return false;
  return rolloutBucket(key, userId) < Math.round(rule.rolloutPercent * 100);
}

export function catalogueDefaults(): FlagValues {
  return Object.fromEntries(FLAG_KEYS.map((k) => [k, FEATURE_FLAGS[k].default])) as FlagValues;
}

/**
 * Defaults with `FEATURE_<KEY>` environment overrides (the flags before AppConfig). A flag is off
 * when its variable is "false" or "0", on when "true" or "1", and the catalogue default otherwise.
 * `prefix` lets the mobile app read `EXPO_PUBLIC_FEATURE_*`.
 */
export function envFlagDefaults(
  env: Record<string, string | undefined>,
  prefix = 'FEATURE_',
): FlagValues {
  const out = catalogueDefaults();
  for (const key of FLAG_KEYS) {
    const value = env[`${prefix}${key.toUpperCase()}`]?.trim().toLowerCase();
    if (value === 'false' || value === '0') out[key] = false;
    else if (value === 'true' || value === '1') out[key] = true;
  }
  return out;
}
