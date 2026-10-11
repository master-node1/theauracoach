import { describe, expect, it } from 'vitest';
import {
  eventEnvelopeSchema,
  eventKey,
  isKnownEvent,
  parseEventData,
  permissionsFor,
  streamKey,
} from '../src';

describe('event envelope', () => {
  const valid = {
    id: '6f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c',
    type: 'UserRegistered',
    version: 1,
    occurredAt: '2026-10-11T06:42:10.000Z',
    producer: 'profile-service',
    userId: '8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c',
    traceparent: null,
    data: {
      userId: '8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
    },
  };

  it('accepts a well-formed envelope', () => {
    expect(eventEnvelopeSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown producer', () => {
    expect(() => eventEnvelopeSchema.parse({ ...valid, producer: 'api-gateway' })).toThrow();
  });

  it('names streams by type and version', () => {
    expect(streamKey('UserRegistered', 1)).toBe('aura.UserRegistered.v1');
  });
});

describe('event catalog', () => {
  it('knows UserRegistered v1 and validates its data', () => {
    const key = eventKey('UserRegistered', 1);
    expect(isKnownEvent(key)).toBe(true);
    expect(() =>
      parseEventData('UserRegistered@1', { userId: 'not-a-uuid', timezone: 'x', locale: 'en' }),
    ).toThrow();
  });

  it('does not know unversioned events', () => {
    expect(isKnownEvent('UserRegistered@2')).toBe(false);
  });
});

describe('permissions', () => {
  it('unions permissions across roles and ignores unknown roles', () => {
    const perms = permissionsFor(['user', 'trainer', 'pirate']);
    expect(perms.has('exercise:write')).toBe(true);
    expect(perms.has('exercise:publish')).toBe(false);
  });

  it('lets content admins publish content but not configure the AI', () => {
    const perms = permissionsFor(['content_admin']);
    expect(perms.has('recipe:publish')).toBe(true);
    expect(perms.has('prompt:publish')).toBe(false);
  });

  it('gives admin every permission', () => {
    expect(permissionsFor(['admin']).has('audit:read')).toBe(true);
    expect(permissionsFor(['admin']).has('prompt:publish')).toBe(true);
  });
});
