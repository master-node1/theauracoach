import { describe, expect, it } from 'vitest';
import {
  eventEnvelopeSchema,
  eventKey,
  isKnownEvent,
  parseEventData,
  passwordIssues,
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

describe('passwordIssues', () => {
  it('lists each unmet rule as a code', () => {
    expect(passwordIssues('short')).toEqual(['minLength', 'upper', 'number']);
    expect(passwordIssues('Long-enough-pass-9')).toEqual([]);
    expect(passwordIssues(`A1${'a'.repeat(300)}`)).toEqual(['tooLong']);
  });
});
