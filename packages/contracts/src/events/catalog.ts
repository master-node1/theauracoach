import { z } from 'zod';
import {
  ACTIVITY_LEVELS,
  CONSENT_PURPOSES,
  DIET_TYPES,
  EXPERIENCE_LEVELS,
  TRAINING_LOCATIONS,
} from '../api/me';

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

/**
 * An admin action to record in the audit log (admin LLD §5). The owning service writes it to its
 * outbox in the same transaction as the change; audit-service stores it append-only.
 * `before` and `after` hold ids and codes only, never free text or health data.
 */
export const auditEventV1 = z.object({
  actorId: z.uuid().nullable(),
  actorRole: z.string().min(1).max(40),
  action: z.string().regex(/^[a-z_]+\.[a-z_]+$/, 'Must look like role.grant'),
  entityType: z.string().min(1).max(40),
  entityId: z.string().min(1).max(100),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  requestId: z.uuid().nullable(),
});
export type AuditEventV1 = z.infer<typeof auditEventV1>;

/**
 * A reviewed content version went live (admin LLD §2). Owners invalidate their library caches;
 * `id` is the live entity's id, which stays the same across versions.
 */
export const CONTENT_PUBLISHED_KINDS = ['exercise', 'template', 'food', 'recipe'] as const;
export const contentPublishedV1 = z.object({
  kind: z.enum(CONTENT_PUBLISHED_KINDS),
  id: z.uuid(),
  version: z.number().int().positive(),
});
export type ContentPublishedV1 = z.infer<typeof contentPublishedV1>;

export const eventCatalog = {
  'UserRegistered@1': userRegisteredV1,
  'ProfileChanged@1': profileChangedV1,
  'ConsentChanged@1': consentChangedV1,
  'AuditEvent@1': auditEventV1,
  'ContentPublished@1': contentPublishedV1,
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
