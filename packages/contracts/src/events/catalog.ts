import { z } from 'zod';
import {
  ACTIVITY_LEVELS,
  CONSENT_PURPOSES,
  DIET_TYPES,
  EXPERIENCE_LEVELS,
  TRAINING_LOCATIONS,
} from '../api/me';
import type { ServiceName } from '../services';

/**
 * Event payload schemas by `Type@version` (platform LLD §4.3).
 * Producers validate before writing to the outbox; consumers validate before handling.
 * Adding an optional field is a minor change; anything else needs a new version.
 */
export const userRegisteredV1 = z.object({
  userId: z.uuid(),
  timezone: z.string().min(1).max(64),
  locale: z.string().min(2).max(16),
});
export type UserRegisteredV1 = z.infer<typeof userRegisteredV1>;

/**
 * Profile fields other services keep a copy of (platform LLD §4.2). `changes` holds the new values
 * of exactly the fields listed in `fields`; display name and units are not shared.
 */
export const PROFILE_SHARED_FIELDS = [
  'timezone',
  'locale',
  'heightCm',
  'activityLevel',
  'experience',
  'dietType',
  'cuisines',
  'allergens',
  'trainingDays',
  'sessionMinutes',
  'location',
  'equipment',
] as const;
export type ProfileSharedField = (typeof PROFILE_SHARED_FIELDS)[number];

export const profileChangedV1 = z.object({
  userId: z.uuid(),
  fields: z.array(z.enum(PROFILE_SHARED_FIELDS)).min(1),
  changes: z
    .object({
      timezone: z.string().min(1).max(64),
      locale: z.string().min(2).max(16),
      heightCm: z.number(),
      activityLevel: z.enum(ACTIVITY_LEVELS),
      experience: z.enum(EXPERIENCE_LEVELS),
      dietType: z.enum(DIET_TYPES),
      cuisines: z.array(z.string()),
      allergens: z.array(z.string()),
      trainingDays: z.array(z.number().int()),
      sessionMinutes: z.number().int(),
      location: z.enum(TRAINING_LOCATIONS),
      equipment: z.array(z.string()),
    })
    .partial(),
});
export type ProfileChangedV1 = z.infer<typeof profileChangedV1>;

/** A consent was recorded. Coach and notification keep a replica so they never call profile-service. */
export const consentChangedV1 = z.object({
  userId: z.uuid(),
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  policyVersion: z.string().min(1).max(20),
});
export type ConsentChangedV1 = z.infer<typeof consentChangedV1>;

/** Services that hold user data and take part in export and deletion (all but profile-service). */
export const DATA_PARTICIPANTS = [
  'workout-service',
  'nutrition-service',
  'progress-service',
  'coach-service',
  'notification-service',
  'audit-service',
] as const satisfies readonly ServiceName[];
export type DataParticipant = (typeof DATA_PARTICIPANTS)[number];

/**
 * A user asked for their data (users LLD §3). Each participant writes its part to object storage
 * under `exportPrefix` as `{service}.json` and answers with ExportPartReady.
 */
export const exportRequestedV1 = z.object({
  requestId: z.uuid(),
  userId: z.uuid(),
  exportPrefix: z.string().min(1).max(200),
});
export type ExportRequestedV1 = z.infer<typeof exportRequestedV1>;

export const exportPartReadyV1 = z.object({
  requestId: z.uuid(),
  userId: z.uuid(),
  service: z.enum(DATA_PARTICIPANTS),
  key: z.string().min(1).max(300),
  rows: z.number().int().min(0),
});
export type ExportPartReadyV1 = z.infer<typeof exportPartReadyV1>;

/** Deletion requested: the 30-day grace period starts. Services refuse the user's requests (423). */
export const accountDeletionRequestedV1 = z.object({
  userId: z.uuid(),
  deletionDueAt: z.iso.datetime(),
});
export type AccountDeletionRequestedV1 = z.infer<typeof accountDeletionRequestedV1>;

/** The user cancelled a pending deletion within the grace period. */
export const accountRestoredV1 = z.object({ userId: z.uuid() });
export type AccountRestoredV1 = z.infer<typeof accountRestoredV1>;

/** Grace period over: every participant deletes the user's data and answers with UserDataPurged. */
export const accountDeletedV1 = z.object({ userId: z.uuid(), requestId: z.uuid() });
export type AccountDeletedV1 = z.infer<typeof accountDeletedV1>;

export const userDataPurgedV1 = z.object({
  userId: z.uuid(),
  requestId: z.uuid(),
  service: z.enum(DATA_PARTICIPANTS),
});
export type UserDataPurgedV1 = z.infer<typeof userDataPurgedV1>;

export const eventCatalog = {
  'UserRegistered@1': userRegisteredV1,
  'ProfileChanged@1': profileChangedV1,
  'ConsentChanged@1': consentChangedV1,
  'ExportRequested@1': exportRequestedV1,
  'ExportPartReady@1': exportPartReadyV1,
  'AccountDeletionRequested@1': accountDeletionRequestedV1,
  'AccountRestored@1': accountRestoredV1,
  'AccountDeleted@1': accountDeletedV1,
  'UserDataPurged@1': userDataPurgedV1,
} as const;

export type EventKey = keyof typeof eventCatalog;
export type EventData<K extends EventKey> = z.infer<(typeof eventCatalog)[K]>;

export function eventKey(type: string, version: number): string {
  return `${type}@${version}`;
}

export function isKnownEvent(key: string): key is EventKey {
  return Object.prototype.hasOwnProperty.call(eventCatalog, key);
}

/** Parses an event's data against its catalogued schema. Throws on unknown events or invalid data. */
export function parseEventData<K extends EventKey>(key: K, data: unknown): EventData<K> {
  return eventCatalog[key].parse(data) as EventData<K>;
}
