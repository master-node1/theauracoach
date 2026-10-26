import { describe, expect, it } from 'vitest';
import {
  consentInputSchema,
  parseEventData,
  preferencesUpdateSchema,
  profileUpdateSchema,
} from '../src';

const issues = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as { issues: { path: PropertyKey[] }[] }).issues.map((i) => i.path.join('.'));
  }
  return [];
};

describe('profile update', () => {
  it('accepts a partial update', () => {
    expect(profileUpdateSchema.parse({ heightCm: 172.5, trainingDays: [1, 3, 5] })).toEqual({
      heightCm: 172.5,
      trainingDays: [1, 3, 5],
    });
  });

  it('names each out-of-range field', () => {
    expect(
      issues(() =>
        profileUpdateSchema.parse({ heightCm: 99, sessionMinutes: 200, trainingDays: [7] }),
      ),
    ).toEqual(expect.arrayContaining(['heightCm', 'sessionMinutes', 'trainingDays.0']));
  });

  it('rejects repeated days, unknown fields, bad codes and unknown time zones', () => {
    expect(() => profileUpdateSchema.parse({ trainingDays: [1, 1] })).toThrow();
    expect(() => profileUpdateSchema.parse({ dateOfBirth: '2000-01-01' })).toThrow();
    expect(() => profileUpdateSchema.parse({ allergens: ['Peanut!'] })).toThrow();
    expect(() => profileUpdateSchema.parse({ timezone: 'Mars/Olympus' })).toThrow();
    expect(profileUpdateSchema.parse({ timezone: 'Europe/London' })).toEqual({
      timezone: 'Europe/London',
    });
  });

  it('rejects an empty body and trims the display name', () => {
    expect(() => profileUpdateSchema.parse({})).toThrow();
    expect(() => profileUpdateSchema.parse({ displayName: '   ' })).toThrow();
    expect(profileUpdateSchema.parse({ displayName: ' Asha ' })).toEqual({ displayName: 'Asha' });
  });
});

describe('preferences and consents', () => {
  it('validates preferences', () => {
    expect(preferencesUpdateSchema.parse({ theme: 'dark' })).toEqual({ theme: 'dark' });
    expect(() => preferencesUpdateSchema.parse({ theme: 'blue' })).toThrow();
    expect(() => preferencesUpdateSchema.parse({})).toThrow();
  });

  it('defaults the consent channel to web', () => {
    expect(
      consentInputSchema.parse({ purpose: 'AI_COACH', granted: true, policyVersion: '2026-10' }),
    ).toEqual({ purpose: 'AI_COACH', granted: true, policyVersion: '2026-10', channel: 'web' });
    expect(() =>
      consentInputSchema.parse({ purpose: 'SPAM', granted: true, policyVersion: '1' }),
    ).toThrow();
  });
});

describe('profile and consent events', () => {
  const userId = '8f1c2a8e-3b7d-4c55-9b1a-2d4e6f8a0b1c';

  it('validates ProfileChanged', () => {
    expect(
      parseEventData('ProfileChanged@1', {
        userId,
        fields: ['heightCm'],
        changes: { heightCm: 170 },
      }),
    ).toEqual({ userId, fields: ['heightCm'], changes: { heightCm: 170 } });
    expect(() =>
      parseEventData('ProfileChanged@1', { userId, fields: ['displayName'], changes: {} }),
    ).toThrow();
  });

  it('validates ConsentChanged', () => {
    expect(() =>
      parseEventData('ConsentChanged@1', {
        userId,
        purpose: 'AI_COACH',
        granted: false,
        policyVersion: '2026-10',
      }),
    ).not.toThrow();
  });
});
