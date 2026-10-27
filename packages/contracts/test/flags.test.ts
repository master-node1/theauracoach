import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  catalogueDefaults,
  envFlagDefaults,
  evaluateFlags,
  flagDocumentSchema,
  rolloutBucket,
} from '../src';

const users = Array.from({ length: 4000 }, () => randomUUID());

describe('flag document', () => {
  it('rejects unknown flags and bad percentages', () => {
    expect(flagDocumentSchema.safeParse({ flags: { setings_v1: { enabled: true } } }).success).toBe(
      false,
    );
    expect(
      flagDocumentSchema.safeParse({ flags: { coach_v1: { enabled: true, rolloutPercent: 101 } } })
        .success,
    ).toBe(false);
    expect(flagDocumentSchema.parse({ flags: {} })).toEqual({ flags: {} });
  });
});

describe('evaluateFlags', () => {
  it('uses the defaults for flags the document does not mention', () => {
    expect(evaluateFlags({ flags: {} }, undefined)).toEqual(catalogueDefaults());
    const values = evaluateFlags({ flags: { coach_enabled: { enabled: false } } }, users[0]);
    expect(values.coach_enabled).toBe(false);
    expect(values.settings_v1).toBe(true);
  });

  it('puts each user in the same bucket every time', () => {
    for (const id of users.slice(0, 50)) {
      expect(rolloutBucket('coach_v1', id)).toBe(rolloutBucket('coach_v1', id));
    }
    const doc = { flags: { coach_v1: { enabled: true, rolloutPercent: 25 } } };
    const first = users.map((id) => evaluateFlags(doc, id).coach_v1);
    const second = users.map((id) => evaluateFlags(doc, id).coach_v1);
    expect(second).toEqual(first);
  });

  it('turns a flag on for about the given share of users, keeping them as it grows', () => {
    const on = (percent: number) =>
      new Set(
        users.filter(
          (id) =>
            evaluateFlags({ flags: { coach_v1: { enabled: true, rolloutPercent: percent } } }, id)
              .coach_v1,
        ),
      );
    const ten = on(10);
    const fifty = on(50);
    expect(ten.size / users.length).toBeGreaterThan(0.07);
    expect(ten.size / users.length).toBeLessThan(0.13);
    expect(fifty.size / users.length).toBeGreaterThan(0.45);
    expect(fifty.size / users.length).toBeLessThan(0.55);
    for (const id of ten) expect(fifty.has(id)).toBe(true);
    expect(on(0).size).toBe(0);
    expect(on(100).size).toBe(users.length);
  });

  it('buckets each flag independently', () => {
    const a = users.filter((id) => rolloutBucket('coach_v1', id) < 5000);
    const b = users.filter((id) => rolloutBucket('nutrition_v1', id) < 5000);
    expect(a).not.toEqual(b);
  });

  it('lets per-user overrides win and keeps rollouts off without a user', () => {
    const [alice, bob] = users as [string, string];
    const doc = {
      flags: { coach_v1: { enabled: false, users: { [alice]: true } } },
    };
    expect(evaluateFlags(doc, alice).coach_v1).toBe(true);
    expect(evaluateFlags(doc, bob).coach_v1).toBe(false);
    const staged = { flags: { coach_v1: { enabled: true, rolloutPercent: 99.99 } } };
    expect(evaluateFlags(staged, undefined).coach_v1).toBe(false);
  });
});

describe('envFlagDefaults', () => {
  it('reads FEATURE_<KEY> overrides on top of the catalogue', () => {
    expect(envFlagDefaults({})).toEqual(catalogueDefaults());
    expect(envFlagDefaults({ FEATURE_SETTINGS_V1: 'false' }).settings_v1).toBe(false);
    expect(envFlagDefaults({ FEATURE_SETTINGS_V1: '0' }).settings_v1).toBe(false);
    expect(envFlagDefaults({ FEATURE_SETTINGS_V1: 'true' }).settings_v1).toBe(true);
    expect(envFlagDefaults({ FEATURE_SETTINGS_V1: 'maybe' }).settings_v1).toBe(true);
    expect(
      envFlagDefaults({ EXPO_PUBLIC_FEATURE_COACH_ENABLED: 'false' }, 'EXPO_PUBLIC_FEATURE_')
        .coach_enabled,
    ).toBe(false);
  });
});
