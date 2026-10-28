import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EXPERIENCE_LEVELS,
  GOAL_TYPES,
  RATIONALE_CODES,
  TRAINING_LOCATIONS,
  generatePlan,
  progressWeek,
  validatePlan,
  type UserTrainingInput,
} from '../../src/workouts';
import { CATALOG, EXERCISE_MAP, GYM_EQUIPMENT, TEMPLATES, ex } from './fixtures';

// TC-WO-10: for any valid input, the generated plan passes validatePlan (10k cases).

const CONDITION_CODES = [
  'injury_knee',
  'injury_lower_back',
  'injury_shoulder',
  'pregnancy',
  'hypertension',
  'asthma',
];

const userArb: fc.Arbitrary<UserTrainingInput> = fc.record({
  goal: fc.constantFrom(...GOAL_TYPES),
  experience: fc.constantFrom(...EXPERIENCE_LEVELS),
  trainingDays: fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 2, maxLength: 6 }),
  sessionMinutes: fc.integer({ min: 15, max: 120 }),
  location: fc.constantFrom(...TRAINING_LOCATIONS),
  equipment: fc.subarray(GYM_EQUIPMENT).chain((eq) =>
    fc.tuple(
      ...eq.map((e) =>
        fc.record({
          code: fc.constant(e.code),
          maxLoadKg: fc.option(fc.constantFrom(10, 20, 40), { nil: undefined }),
          incrementKg: fc.option(fc.constantFrom(1, 1.25, 2.5), { nil: undefined }),
        }),
      ),
    ),
  ),
  conditions: fc.uniqueArray(
    fc.record({
      code: fc.constantFrom(...CONDITION_CODES),
      severity: fc.constantFrom('mild' as const, 'moderate' as const, 'severe' as const),
    }),
    { maxLength: 3, selector: (c) => c.code },
  ),
  intensityCap: fc.constantFrom('STANDARD' as const, 'LOW' as const),
  bodyweightKg: fc.option(fc.integer({ min: 40, max: 150 }), { nil: null }),
});

const codes = new Set<string>(RATIONALE_CODES);

// Thousands of runs under coverage on a shared CI runner take longer than vitest's 5 s default.
describe('generatePlan properties', { timeout: 60_000 }, () => {
  it('always produces a plan that passes validatePlan (TC-WO-10)', () => {
    fc.assert(
      fc.property(userArb, (u) => {
        const result = generatePlan(u, CATALOG);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(validatePlan(result.week, u, EXERCISE_MAP)).toEqual({ valid: true, issues: [] });
        expect(new Set(result.week.sessions.map((s) => s.dayOfWeek)).size).toBe(
          result.week.sessions.length,
        );
        expect(result.week.sessions.every((s) => u.trainingDays.includes(s.dayOfWeek))).toBe(true);
        expect(result.week.rationale.every((r) => codes.has(r.code))).toBe(true);
      }),
      { numRuns: 10_000 },
    );
  });

  it('never prescribes knee_high_load to moderate or severe knee injuries, over every fixture template (TC-ONB-3)', () => {
    for (const t of TEMPLATES) {
      fc.assert(
        fc.property(
          userArb,
          fc.constantFrom('moderate' as const, 'severe' as const),
          (u, severity) => {
            const input = {
              ...u,
              goal: t.goal,
              experience: t.experience,
              location: t.location,
              conditions: [{ code: 'injury_knee', severity }],
            };
            const result = generatePlan(input, { ...CATALOG, templates: [t, TEMPLATES[0]!] });
            if (!result.ok) throw new Error(result.error);
            const used = result.week.sessions.flatMap((s) =>
              s.exercises.map((e) => ex(e.exerciseId)),
            );
            expect(used.some((e) => e.contraindications.includes('knee_high_load'))).toBe(false);
          },
        ),
        { numRuns: 300 },
      );
    }
  });

  it('keeps RPE ≤ 6 for intensityCap LOW in the generated and every adapted week (TC-ONB-2)', () => {
    fc.assert(
      fc.property(userArb, fc.integer({ min: 0, max: 10 }), (u, weekIndex) => {
        const input = { ...u, intensityCap: 'LOW' as const };
        const result = generatePlan(input, CATALOG);
        if (!result.ok) throw new Error(result.error);
        const first = { ...result.week, weekIndex };
        const next = progressWeek({
          week: first,
          logs: first.sessions.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            date: '2026-11-02',
            status: 'COMPLETED' as const,
            perceivedDifficulty: 5,
            soreness: 2,
            sets: s.exercises.flatMap((e) =>
              Array.from({ length: e.sets }, (_, i) => ({
                exerciseId: e.exerciseId,
                setNumber: i + 1,
                reps: e.repMax,
                loadKg: 10,
                rpe: 5,
              })),
            ),
          })),
          user: input,
          catalog: EXERCISE_MAP,
          history: { fatigueWeeksInRow: 0, missedWeeksInRow: 0, painReports: [] },
          recovery: {},
          weekStart: '2026-11-09',
        });
        for (const w of [first, next.week]) {
          expect(w.sessions.flatMap((s) => s.exercises).every((e) => e.targetRpe <= 6)).toBe(true);
        }
        expect(next.week.rationale.every((r) => codes.has(r.code))).toBe(true);
      }),
      { numRuns: 1_000 },
    );
  });
});
