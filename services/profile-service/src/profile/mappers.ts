import type {
  CoachTone,
  MeResponse,
  PreferencesResponse,
  ProfileResponse,
  Theme,
} from '@aura/contracts';
import type { Profile, UserPreference } from '../generated/prisma';
import type { UserWithAccess } from '../identity/user-provisioning.service';

/** Preferences before the user saves any (the row is created on first change). */
export const DEFAULT_PREFERENCES: PreferencesResponse = {
  theme: 'system',
  coachTone: 'supportive',
};

export function toProfile(profile: Profile): ProfileResponse {
  return {
    dateOfBirth: profile.dateOfBirth.toISOString().slice(0, 10),
    sex: profile.sex,
    heightCm: profile.heightCm.toNumber(),
    activityLevel: profile.activityLevel,
    experience: profile.experience,
    unitSystem: profile.unitSystem,
    dietType: profile.dietType,
    cuisines: profile.cuisines,
    allergens: profile.allergens,
    trainingDays: profile.trainingDays,
    sessionMinutes: profile.sessionMinutes,
    location: profile.location,
    equipment: profile.equipmentCodes,
    intensityCap: profile.intensityCap,
  };
}

export function toPreferences(preference: UserPreference | null): PreferencesResponse {
  if (!preference) return DEFAULT_PREFERENCES;
  return { theme: preference.theme as Theme, coachTone: preference.coachTone as CoachTone };
}

export function toMe(user: UserWithAccess): MeResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone: user.timezone,
    locale: user.locale,
    onboardingComplete: user.onboarding?.status === 'READY',
    status: user.status === 'PENDING_DELETION' ? 'PENDING_DELETION' : 'ACTIVE',
    roles: ['user', ...user.roles.map((r) => r.roleId).filter((r) => r !== 'user')],
    profile: user.profile ? toProfile(user.profile) : null,
    preferences: toPreferences(user.preference),
  };
}
