import { describe, expect, it } from 'vitest';
import {
  adminFoodInputSchema,
  adminFoodPatchSchema,
  contentTransition,
  foodSearchQuerySchema,
  eventEnvelopeSchema,
  eventKey,
  isKnownEvent,
  parseEventData,
  GRANTABLE_ROLES,
  hasMfa,
  PERMISSIONS,
  permissionsFor,
  roleGrantSchema,
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
    const perms = permissionsFor(['user', 'content_editor', 'pirate']);
    expect(perms.has('exercise:write')).toBe(true);
    expect(perms.has('exercise:publish')).toBe(false);
  });

  it('splits drafting from reviewing and keeps AI config with owners', () => {
    expect(permissionsFor(['content_reviewer']).has('template:publish')).toBe(true);
    expect(permissionsFor(['content_reviewer']).has('food:publish')).toBe(false);
    expect(permissionsFor(['nutrition_reviewer']).has('recipe:publish')).toBe(true);
    for (const role of ['content_editor', 'content_reviewer', 'nutrition_reviewer', 'support']) {
      expect(permissionsFor([role]).has('prompt:publish')).toBe(false);
      expect(permissionsFor([role]).has('role:grant')).toBe(false);
    }
  });

  it('gives owner every permission and user none', () => {
    expect(permissionsFor(['owner']).size).toBe(PERMISSIONS.length);
    expect(permissionsFor(['user']).size).toBe(0);
    expect(GRANTABLE_ROLES).not.toContain('user');
  });

  it('counts only multi-factor methods as MFA', () => {
    expect(hasMfa(['pwd', 'mfa'])).toBe(true);
    expect(hasMfa(['otp'])).toBe(true);
    expect(hasMfa(['pwd'])).toBe(false);
    expect(hasMfa(undefined)).toBe(false);
  });
});

describe('role grant input', () => {
  it('takes exactly one of userId or email and a grantable role', () => {
    expect(roleGrantSchema.safeParse({ email: 'a@example.com', role: 'support' }).success).toBe(
      true,
    );
    expect(roleGrantSchema.safeParse({ role: 'support' }).success).toBe(false);
    expect(roleGrantSchema.safeParse({ email: 'a@example.com', role: 'user' }).success).toBe(false);
  });
});

describe('content workflow', () => {
  it('moves drafts through review to published and archived, and nothing else', () => {
    expect(contentTransition('submit', 'DRAFT')).toBe('IN_REVIEW');
    expect(contentTransition('reject', 'IN_REVIEW')).toBe('DRAFT');
    expect(contentTransition('publish', 'IN_REVIEW')).toBe('PUBLISHED');
    expect(contentTransition('archive', 'PUBLISHED')).toBe('ARCHIVED');
    expect(contentTransition('publish', 'DRAFT')).toBeNull();
    expect(contentTransition('archive', 'DRAFT')).toBeNull();
    expect(contentTransition('submit', 'PUBLISHED')).toBeNull();
  });

  it('validates ContentPublished v1', () => {
    const data = { kind: 'food', id: '7d5bd1fd-6c40-4c4f-a2f2-5a7a2a7d3c11', version: 2 };
    expect(parseEventData('ContentPublished@1', data)).toEqual(data);
    expect(() => parseEventData('ContentPublished@1', { ...data, version: 0 })).toThrow();
  });
});

describe('food catalogue inputs', () => {
  it('parses search queries with defaults and a numeric cursor', () => {
    expect(foodSearchQuerySchema.parse({ q: ' dal ' })).toEqual({
      q: 'dal',
      showAll: false,
      limit: 20,
    });
    expect(
      foodSearchQuerySchema.parse({ q: 'roti', showAll: 'true', limit: '5', cursor: '20' }),
    ).toEqual({ q: 'roti', showAll: true, limit: 5, cursor: '20' });
    expect(() => foodSearchQuerySchema.parse({ q: '' })).toThrow();
    expect(() => foodSearchQuerySchema.parse({ q: 'x', cursor: 'abc' })).toThrow();
  });

  it('refuses composite and user sources on hand-entered foods', () => {
    const food = {
      name: 'Toor dal',
      source: 'CURATED_INGREDIENT',
      confidence: 'MEDIUM',
      state: 'RAW',
      nutrients: { energyKcal: 343, proteinG: 22, carbsG: 57, fatG: 1.5, fibreG: 9 },
    };
    expect(adminFoodInputSchema.parse(food)).toMatchObject({
      localNames: [],
      units: [],
      flags: [],
    });
    expect(() => adminFoodInputSchema.parse({ ...food, source: 'CURATED_RECIPE' })).toThrow();
    expect(() => adminFoodInputSchema.parse({ ...food, source: 'USER' })).toThrow();
    expect(() => adminFoodInputSchema.parse({ ...food, flags: ['VEGGIE'] })).toThrow();
  });

  it('keeps patches to the fields sent', () => {
    expect(adminFoodPatchSchema.parse({ name: 'Arhar dal' })).toEqual({ name: 'Arhar dal' });
  });
});
