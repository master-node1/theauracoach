import { z } from 'zod';

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

export const eventCatalog = {
  'UserRegistered@1': userRegisteredV1,
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
