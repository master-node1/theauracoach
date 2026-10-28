import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKOUT_POLICY,
  estimateSessionMinutes,
  validatePlan,
  weeklySetsByMuscle,
  type PlanWeek,
  type UserTrainingInput,
  type ValidationRule,
} from '../../src/workouts';
import { EXERCISE_MAP, user } from './fixtures';
import { pe, week } from './helpers';

const rules = (w: PlanWeek, u: UserTrainingInput = user()): ValidationRule[] =>
  validatePlan(w, u, EXERCISE_MAP).issues.map((i) => i.rule);

const ok = week([
  [0, [pe('goblet-squat'), pe('push-up')]],
  [2, [pe('dumbbell-rdl'), pe('dumbbell-row')]],
]);

describe('validatePlan', () => {
  it('accepts a plan within every rule', () => {
    expect(validatePlan(ok, user(), EXERCISE_MAP, DEFAULT_WORKOUT_POLICY)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it.each([
    ['non-integer day', 1.5],
    ['negative day', -1],
    ['day past Sunday', 7],
  ])('rejects a %s', (_, day) => {
    expect(rules(week([[day, [pe('push-up')]]]))).toEqual(['INVALID_DAY']);
  });

  it('rejects two sessions on the same day', () => {
    const issues = validatePlan(
      week([
        [1, [pe('push-up')]],
        [1, [pe('goblet-squat')]],
      ]),
      user(),
      EXERCISE_MAP,
    ).issues;
    expect(issues).toEqual([{ rule: 'SESSIONS_SAME_DAY', session: 1 }]);
  });

  it('allows sessionMinutes + 10 and rejects anything longer', () => {
    // 60 min + 10 overrun = 70; 8 warm-up + 24 sets × 2.5 = 68, 26 sets = 73.
    const at = (n: number) => week([[0, [pe('goblet-squat', { sets: n })]]]);
    const roomy = user({ experience: 'ADVANCED' });
    expect(rules(at(24), roomy).filter((r) => r === 'SESSION_TOO_LONG')).toEqual([]);
    expect(rules(at(26), roomy)).toContain('SESSION_TOO_LONG');
  });

  it.each<[string, object]>([
    ['fractional sets', { sets: 2.5 }],
    ['zero sets', { sets: 0 }],
    ['fractional repMin', { repMin: 7.5 }],
    ['fractional repMax', { repMax: 11.5 }],
    ['zero repMin', { repMin: 0 }],
    ['repMin above repMax', { repMin: 13 }],
    ['negative rest', { restSec: -1 }],
    ['negative load', { targetLoadKg: -5 }],
    ['target reps below range', { targetReps: 7 }],
    ['target reps above range', { targetReps: 13 }],
  ])('rejects %s', (_, overrides) => {
    expect(rules(week([[0, [pe('push-up', overrides)]]]))).toContain('INVALID_PRESCRIPTION');
  });

  it('accepts a load and a target inside the range', () => {
    expect(rules(week([[0, [pe('goblet-squat', { targetLoadKg: 12, targetReps: 10 })]]]))).toEqual(
      [],
    );
  });

  it('caps RPE at 10, or 6 under intensityCap LOW, and bans 1–5 rep work under LOW', () => {
    expect(rules(week([[0, [pe('push-up', { targetRpe: 10 })]]]))).toEqual([]);
    expect(rules(week([[0, [pe('push-up', { targetRpe: 10.5 })]]]))).toEqual(['RPE_ABOVE_CAP']);
    const low = user({ intensityCap: 'LOW' });
    expect(rules(week([[0, [pe('push-up', { targetRpe: 6 })]]]), low)).toEqual([]);
    expect(rules(week([[0, [pe('push-up', { targetRpe: 7, repMin: 5 })]]]), low)).toEqual([
      'RPE_ABOVE_CAP',
      'LOW_CAP_HEAVY_REPS',
    ]);
  });

  it('rejects unknown, unpublished, unavailable, too-hard and contraindicated exercises', () => {
    const home = user({ equipment: [], conditions: [{ code: 'injury_knee', severity: 'severe' }] });
    expect(
      rules(
        week([[0, [pe('nope'), pe('draft-press'), pe('goblet-squat'), pe('jump-squat')]]]),
        home,
      ),
    ).toEqual([
      'UNKNOWN_EXERCISE',
      'EXERCISE_NOT_PUBLISHED',
      'EQUIPMENT_UNAVAILABLE',
      'DIFFICULTY_ABOVE_EXPERIENCE',
    ]);
    expect(
      rules(
        week([[0, [pe('leg-press')]]]),
        user({ conditions: [{ code: 'injury_knee', severity: 'moderate' }] }),
      ),
    ).toEqual(['CONTRAINDICATED_EXERCISE']);
  });

  it('rejects weekly sets above the experience maximum', () => {
    const issues = validatePlan(
      week([
        [0, [pe('push-up', { sets: 6 })]],
        [2, [pe('incline-push-up', { sets: 5 })]],
      ]),
      user(),
      EXERCISE_MAP,
    ).issues;
    expect(issues).toEqual([
      { rule: 'WEEKLY_VOLUME_ABOVE_MAX', muscle: 'chest' },
      { rule: 'WEEKLY_VOLUME_ABOVE_MAX', muscle: 'triceps' },
    ]);
  });

  it('allows beginners at most two heavy-hinge sessions a week', () => {
    const hinges = (n: number) =>
      week(
        Array.from(
          { length: n },
          (_, i) =>
            [i * 2, [pe('dumbbell-rdl', { sets: 2 }), pe('glute-bridge', { sets: 1 })]] as [
              number,
              ReturnType<typeof pe>[],
            ],
        ),
      );
    expect(rules(hinges(2))).toEqual([]);
    expect(rules(hinges(3))).toEqual(['BEGINNER_HINGE_FREQUENCY']);
    expect(rules(hinges(3), user({ experience: 'INTERMEDIATE' }))).toEqual([]);
  });
});

describe('plan maths', () => {
  it('estimates 8 minutes of warm-up plus 2.5 minutes per set', () => {
    expect(estimateSessionMinutes([{ sets: 3 }, { sets: 4 }])).toBe(25.5);
  });

  it('counts sets per primary muscle and ignores unknown exercises', () => {
    const totals = weeklySetsByMuscle(week([[0, [pe('push-up'), pe('ghost')]]]), EXERCISE_MAP);
    expect(Object.fromEntries(totals)).toEqual({ chest: 3, triceps: 3 });
  });
});
