import { describe, expect, it } from 'vitest';
import { checkTemplate, templateCheckProfiles, type WorkoutTemplate } from '../../src/workouts';
import { EXERCISES, SAFE_DEFAULT, TEMPLATES, template } from './fixtures';

describe('templateCheckProfiles', () => {
  it('gives 20 distinct users matching the template, at its level or above', () => {
    const t = TEMPLATES[1]!;
    const profiles = templateCheckProfiles(t);
    expect(profiles).toHaveLength(20);
    expect(new Set(profiles.map((p) => p.label)).size).toBe(20);
    for (const { input } of profiles) {
      expect(input.goal).toBe(t.goal);
      expect(input.location).toBe(t.location);
      expect(input.trainingDays).toHaveLength(t.daysPerWeek);
      expect(new Set(input.trainingDays).size).toBe(input.trainingDays.length);
    }
    expect(profiles.some((p) => p.input.intensityCap === 'LOW')).toBe(true);
    const codes = new Set(profiles.flatMap((p) => p.input.conditions.map((c) => c.code)));
    expect([...codes].sort()).toEqual([
      'hypertension',
      'injury_knee',
      'injury_lower_back',
      'injury_shoulder',
      'pregnancy',
    ]);
  });

  it('moves the "more experienced" user up one level, capped at advanced', () => {
    const level = (t: WorkoutTemplate) =>
      templateCheckProfiles(t).find((p) => p.label === 'more experienced user')!.input.experience;
    expect(level(SAFE_DEFAULT)).toBe('INTERMEDIATE');
    expect(level({ ...SAFE_DEFAULT, experience: 'ADVANCED' })).toBe('ADVANCED');
  });

  it('uses as many distinct days as the template asks for, 2 to 6', () => {
    for (const days of [2, 3, 4, 5, 6]) {
      const profiles = templateCheckProfiles({ ...SAFE_DEFAULT, daysPerWeek: days });
      for (const { input } of profiles) {
        expect(new Set(input.trainingDays).size).toBe(days);
      }
    }
  });
});

describe('checkTemplate', () => {
  it('passes every fixture template, including the safe default', () => {
    for (const t of TEMPLATES) {
      expect({ slug: t.slug, ...checkTemplate(t, EXERCISES) }).toEqual({
        slug: t.slug,
        ok: true,
        failures: [],
      });
    }
  });

  it('checks a template under review as if it were published', () => {
    expect(checkTemplate({ ...SAFE_DEFAULT, status: 'IN_REVIEW' }, EXERCISES).ok).toBe(true);
  });

  it('fails a template whose exercises are not in the library, for every profile', () => {
    const broken = template(
      'broken',
      { goal: 'STRENGTH', experience: 'BEGINNER', location: 'GYM', split: 'full_body' },
      [['Day A', 'full body', [['no-such-exercise', 3, 5, 8, 7]]]],
    );
    const result = checkTemplate({ ...broken, daysPerWeek: 3 }, EXERCISES);
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(20);
    expect(result.failures[0]).toMatchObject({ profile: 'baseline', error: 'PLAN_INVALID' });
  });

  it('fails a safe default that cannot build a week even from itself', () => {
    const unsafe = template(
      SAFE_DEFAULT.slug,
      { goal: 'GENERAL_FITNESS', experience: 'BEGINNER', location: 'HOME', split: 'full_body' },
      [['Day A', 'full body', [['retired-exercise', 3, 5, 8, 7]]]],
    );
    const result = checkTemplate({ ...unsafe, daysPerWeek: 2 }, EXERCISES);
    expect(result.ok).toBe(false);
    expect(new Set(result.failures.map((f) => f.error))).toEqual(
      new Set(['NO_ELIGIBLE_EXERCISES']),
    );
  });
});
