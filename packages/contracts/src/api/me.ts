import { z } from 'zod';

/**
 * Request bodies and response shapes for the `/v1/me*` routes (docs/api/openapi.yaml, users LLD).
 * profile-service validates with the schemas; the apps use the types through packages/api-client.
 */

export const ACTIVITY_LEVELS = ['SEDENTARY', 'LIGHT', 'MODERATE', 'ACTIVE', 'VERY_ACTIVE'] as const;
export const EXPERIENCE_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const;
export const DIET_TYPES = [
  'VEGETARIAN',
  'EGGETARIAN',
  'NON_VEGETARIAN',
  'VEGAN',
  'JAIN',
  'PESCATARIAN',
] as const;
export const TRAINING_LOCATIONS = ['GYM', 'HOME', 'OUTDOOR'] as const;
export const UNIT_SYSTEMS = ['METRIC', 'IMPERIAL'] as const;
export const SEXES = ['FEMALE', 'MALE'] as const;
export const INTENSITY_CAPS = ['STANDARD', 'LOW'] as const;
export const THEMES = ['system', 'light', 'dark'] as const;
export const COACH_TONES = ['supportive', 'direct'] as const;
export const CONSENT_PURPOSES = [
  'CORE_SERVICE',
  'AI_COACH',
  'NOTIFICATIONS',
  'MARKETING',
  'PROGRESS_PHOTOS',
  'HEALTH_INTEGRATIONS',
] as const;
export const CONSENT_CHANNELS = ['ios', 'android', 'web'] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type Theme = (typeof THEMES)[number];
export type CoachTone = (typeof COACH_TONES)[number];
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/** Lower-case codes from a controlled vocabulary (cuisines, allergens, equipment). */
const code = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Must be a lower_snake_case code');

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** `ProfileUpdate`. Account fields apply at any time; profile fields need a profile (created in onboarding). */
export const profileUpdateSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).max(60),
    timezone: z.string().max(64).refine(isTimeZone, 'Unknown time zone'),
    locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/, 'Must look like en-IN'),
    heightCm: z.number().min(100).max(250),
    activityLevel: z.enum(ACTIVITY_LEVELS),
    experience: z.enum(EXPERIENCE_LEVELS),
    unitSystem: z.enum(UNIT_SYSTEMS),
    dietType: z.enum(DIET_TYPES),
    cuisines: z.array(code).max(10),
    allergens: z.array(code).max(20),
    trainingDays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'Days must not repeat'),
    sessionMinutes: z.number().int().min(15).max(120),
    location: z.enum(TRAINING_LOCATIONS),
    equipment: z.array(code).max(30),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const ACCOUNT_FIELDS = ['displayName', 'timezone', 'locale'] as const;

export const preferencesUpdateSchema = z
  .strictObject({
    theme: z.enum(THEMES),
    coachTone: z.enum(COACH_TONES),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

export const consentInputSchema = z.strictObject({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  policyVersion: z.string().min(1).max(20),
  channel: z.enum(CONSENT_CHANNELS).default('web'),
});
export type ConsentInput = z.input<typeof consentInputSchema>;
/** A consent body after validation (channel defaulted). */
export type ConsentRecord = z.output<typeof consentInputSchema>;

/** `Profile` in the OpenAPI document. */
export interface ProfileResponse {
  dateOfBirth: string;
  sex: (typeof SEXES)[number];
  heightCm: number;
  activityLevel: (typeof ACTIVITY_LEVELS)[number];
  experience: (typeof EXPERIENCE_LEVELS)[number];
  unitSystem: UnitSystem;
  dietType: (typeof DIET_TYPES)[number];
  cuisines: string[];
  allergens: string[];
  trainingDays: number[];
  sessionMinutes: number;
  location: (typeof TRAINING_LOCATIONS)[number];
  equipment: string[];
  intensityCap: (typeof INTENSITY_CAPS)[number];
}

export interface PreferencesResponse {
  theme: Theme;
  coachTone: CoachTone;
}

export interface ConsentResponse {
  purpose: ConsentPurpose;
  granted: boolean;
  policyVersion: string;
  createdAt: string;
}

/** `Me` in the OpenAPI document. `profile` is null until onboarding creates it. */
export interface MeResponse {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  locale: string;
  onboardingComplete: boolean;
  status: 'ACTIVE' | 'PENDING_DELETION';
  roles: string[];
  profile: ProfileResponse | null;
  preferences: PreferencesResponse;
}

export interface ProfileUpdateResponse {
  profile: ProfileResponse | null;
  /** Plan proposals from workout and nutrition arrive later as recommendations; always empty here. */
  proposals: unknown[];
}

/** `GET /internal/v1/users/{id}/context`: the minimum coach-service needs (ai-coach LLD §5). */
export interface UserContextResponse {
  userId: string;
  /** Five-year band such as `30-34`; null before onboarding. */
  ageBand: string | null;
  unitSystem: UnitSystem;
  timezone: string;
  locale: string;
  coachTone: CoachTone;
}
