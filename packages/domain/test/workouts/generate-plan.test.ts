import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKOUT_POLICY,
  generatePlan,
  selectTemplate,
  validatePlan,
  type GeneratePlanResult,
  type PlanWeek,
  type UserTrainingInput,
} from '../../src/workouts';
import {
  CATALOG,
  EXERCISE_MAP,
  EXERCISES,
  SAFE_DEFAULT,
  TEMPLATES,
  ex,
  template,
  user,
} from './fixtures';

function plan(
  u: UserTrainingInput,
  catalog = CATALOG,
  policy = DEFAULT_WORKOUT_POLICY,
): Extract<GeneratePlanResult, { ok: true }> {
  const result = generatePlan(u, catalog, policy);
  if (!result.ok) throw new Error(`expected a plan, got ${result.error}`);
  return result;
}
const all = (w: PlanWeek) => w.sessions.flatMap((s) => s.exercises);
const codes = (w: PlanWeek) => w.rationale.map((r) => r.code);

describe('template selection', () => {
  const pick = (u: Partial<UserTrainingInput>) => selectTemplate(TEMPLATES, user(u));

  it('prefers goal, experience, days and location', () => {
    expect(
      pick({ goal: 'MUSCLE_GAIN', experience: 'INTERMEDIATE', trainingDays: [0, 1, 3, 4] }),
    ).toMatchObject({
      template: { slug: 'ul-4-gym-intermediate-hypertrophy' },
      rationale: { code: 'TEMPLATE_SELECTED' },
    });
  });

  it('falls back to the same goal at another location', () => {
    expect(pick({ goal: 'FAT_LOSS', location: 'GYM' })).toMatchObject({
      template: { slug: 'fb-3-home-beginner-fatloss' },
      rationale: { code: 'TEMPLATE_FALLBACK_LOCATION' },
    });
  });

  it('falls back to general fitness, at the same location first', () => {
    expect(pick({ goal: 'STRENGTH', location: 'GYM' })?.template.slug).toBe(
      'fb-3-gym-beginner-general',
    );
    expect(pick({ goal: 'ENDURANCE', location: 'OUTDOOR', trainingDays: [0, 3] })).toMatchObject({
      template: { slug: 'fb-2-home-beginner-general' },
      rationale: { code: 'TEMPLATE_FALLBACK_GENERAL' },
    });
  });

  it('steps down an experience level before giving up, and ignores drafts', () => {
    expect(pick({ goal: 'GENERAL_FITNESS', experience: 'ADVANCED' })?.template.slug).toBe(
      'fb-3-gym-beginner-general',
    );
    expect(pick({ trainingDays: [0, 1, 2, 3, 4] })).toBeNull();
    expect(selectTemplate([TEMPLATES.at(-1)!], user())).toBeNull();
  });
});

describe('generatePlan', () => {
  it('rejects input outside the engine contract', () => {
    for (const trainingDays of [[1], [0, 1, 2, 3, 4, 5, 6], [1, 1], [0, 7], [0.5, 2]]) {
      expect(generatePlan(user({ trainingDays }), CATALOG)).toEqual({
        ok: false,
        error: 'INVALID_INPUT',
      });
    }
    expect(generatePlan(user({ sessionMinutes: 10 }), CATALOG)).toEqual({
      ok: false,
      error: 'INVALID_INPUT',
    });
  });

  it('builds a valid week from the selected template, on the training days', () => {
    const u = user({ goal: 'MUSCLE_GAIN', experience: 'INTERMEDIATE', trainingDays: [0, 1, 3, 4] });
    const result = plan(u);
    expect(result).toMatchObject({
      templateId: 'ul-4-gym-intermediate-hypertrophy',
      fallback: false,
      rejectedIssues: [],
    });
    expect(result.week.sessions.map((s) => [s.dayOfWeek, s.name])).toEqual([
      [0, 'Upper A'],
      [1, 'Lower A'],
      [3, 'Upper B'],
      [4, 'Lower B'],
    ]);
    expect(validatePlan(result.week, u, EXERCISE_MAP).valid).toBe(true);
    expect(
      all(result.week).every((e) => e.targetLoadKg === null && e.repMin === 8 && e.repMax === 12),
    ).toBe(true);
  });

  it('is deterministic', () => {
    const u = user({ goal: 'STRENGTH', experience: 'ADVANCED', trainingDays: [0, 1, 2, 3, 4, 5] });
    expect(generatePlan(u, CATALOG)).toEqual(generatePlan(u, CATALOG));
  });

  it('uses goal rep ranges and RPE bands', () => {
    const strength = plan(
      user({
        goal: 'STRENGTH',
        experience: 'ADVANCED',
        trainingDays: [0, 1, 2, 3, 4, 5],
        sessionMinutes: 120,
      }),
    );
    const bench = all(strength.week).find((e) => e.exerciseId === 'barbell-bench-press')!;
    const fly = all(strength.week).find((e) => e.exerciseId === 'cable-fly')!;
    expect([bench.repMin, bench.repMax, fly.repMin, fly.repMax]).toEqual([3, 6, 8, 12]);
    const endurance = plan(
      user({ goal: 'ENDURANCE', experience: 'INTERMEDIATE', trainingDays: [0, 1, 3, 4] }),
    );
    expect(
      all(endurance.week).every(
        (e) => e.repMin === 12 && e.repMax === 20 && e.targetRpe >= 7 && e.targetRpe <= 8,
      ),
    ).toBe(true);
    const beginner = plan(user());
    expect(all(beginner.week).every((e) => e.targetRpe >= 6 && e.targetRpe <= 7)).toBe(true);
  });

  it('swaps exercises the user cannot do for the best-ranked eligible one', () => {
    const result = plan(user({ location: 'HOME', goal: 'FAT_LOSS', equipment: [] }));
    const used = all(result.week).map((e) => ex(e.exerciseId));
    expect(used.every((e) => e.equipment.length === 0)).toBe(true);
    expect(result.week.rationale).toContainEqual({
      code: 'EXERCISE_RESOLVED',
      exerciseId: 'doorway-row',
      detail: { fromExerciseId: 'dumbbell-row', reason: 'EQUIPMENT' },
    });
  });

  it('ranks candidates by past completion rate after pattern, muscle and mechanics', () => {
    const u = user({
      location: 'HOME',
      goal: 'FAT_LOSS',
      equipment: [{ code: 'resistance_band' }],
    });
    expect(all(plan(u).week).some((e) => e.exerciseId === 'band-row')).toBe(true);
    const preferDoorway = plan({ ...u, completionRates: { 'doorway-row': 0.9 } });
    expect(
      all(preferDoorway.week).filter((e) => e.exerciseId === 'doorway-row').length,
    ).toBeGreaterThan(0);
  });

  it('drops slots with no eligible candidate and unknown exercises', () => {
    const odd = template(
      'odd-2',
      { goal: 'ENDURANCE', experience: 'BEGINNER', location: 'OUTDOOR', split: 'full_body' },
      [
        [
          'A',
          'a',
          [
            ['neck-harness', 3, 8, 12, 7],
            ['missing', 3, 8, 12, 7],
            ['push-up', 3, 8, 12, 7],
          ],
        ],
        ['B', 'b', [['push-up', 3, 8, 12, 7]]],
      ],
    );
    // Nothing else trains the neck, so a user without the harness gets no stand-in.
    const harness = {
      ...ex('farmer-carry'),
      id: 'neck-harness',
      slug: 'neck-harness',
      equipment: ['neck_harness'],
      primaryMuscles: ['neck'],
    };
    const result = plan(
      user({ goal: 'ENDURANCE', location: 'OUTDOOR', trainingDays: [1, 4], equipment: [] }),
      {
        exercises: [...EXERCISES, harness],
        templates: [odd],
      },
    );
    expect(result.week.rationale).toEqual(
      expect.arrayContaining([
        { code: 'SLOT_DROPPED', exerciseId: 'neck-harness', detail: { reason: 'NO_CANDIDATE' } },
        { code: 'SLOT_DROPPED', exerciseId: 'missing', detail: { reason: 'UNKNOWN_EXERCISE' } },
      ]),
    );
    expect(result.week.sessions.map((s) => s.exercises.map((e) => e.exerciseId))).toEqual([
      ['push-up'],
      ['push-up'],
    ]);
  });

  it('does not repeat an exercise inside a session', () => {
    const twice = template(
      'twice-2',
      { goal: 'ENDURANCE', experience: 'BEGINNER', location: 'HOME', split: 'full_body' },
      [
        [
          'A',
          'a',
          [
            ['push-up', 2, 8, 12, 7],
            ['push-up', 2, 8, 12, 7],
          ],
        ],
        ['B', 'b', [['plank', 2, 8, 12, 7]]],
      ],
    );
    const result = plan(
      user({ goal: 'ENDURANCE', location: 'HOME', trainingDays: [1, 4], equipment: [] }),
      { ...CATALOG, templates: [twice] },
    );
    expect(result.week.sessions[0]!.exercises.map((e) => e.exerciseId)).toEqual([
      'push-up',
      'incline-push-up',
    ]);
    expect(result.week.rationale).toContainEqual({
      code: 'EXERCISE_RESOLVED',
      exerciseId: 'incline-push-up',
      detail: { fromExerciseId: 'push-up', reason: 'DUPLICATE' },
    });
  });

  it('fits each session into sessionMinutes (≈ 2.5 min a set + 8 min warm-up)', () => {
    const result = plan(
      user({
        goal: 'STRENGTH',
        experience: 'ADVANCED',
        trainingDays: [0, 1, 2, 3, 4, 5],
        sessionMinutes: 30,
      }),
    );
    for (const s of result.week.sessions)
      expect(8 + 2.5 * s.exercises.reduce((n, e) => n + e.sets, 0)).toBeLessThanOrEqual(30);
    expect(codes(result.week)).toContain('VOLUME_FITTED_TO_TIME');
  });

  it('keeps fat loss and general fitness at the lower volume bound, others under the upper', () => {
    const general = plan(user());
    const totals = new Map<string, number>();
    for (const e of all(general.week))
      for (const m of ex(e.exerciseId).primaryMuscles) totals.set(m, (totals.get(m) ?? 0) + e.sets);
    expect(Math.max(...totals.values())).toBeLessThanOrEqual(8);
    expect(general.week.rationale).toContainEqual({
      code: 'VOLUME_CAPPED',
      detail: { muscle: 'quadriceps', weeklySets: 8 },
    });
  });

  it('limits beginners to two heavy-hinge sessions a week', () => {
    const result = plan(user());
    const hinge = result.week.sessions.filter((s) =>
      s.exercises.some((e) => e.exerciseId === 'barbell-rdl'),
    );
    expect(hinge).toHaveLength(2);
    expect(codes(result.week)).toContain('HINGE_FREQUENCY_LIMITED');
  });

  it('avoids consecutive days for the same muscles when the split allows it', () => {
    const result = plan(
      user({ goal: 'MUSCLE_GAIN', experience: 'INTERMEDIATE', trainingDays: [6, 0, 2, 3] }),
    );
    expect(result.week.sessions.map((s) => [s.dayOfWeek, s.focus])).toEqual([
      [0, 'upper'],
      [2, 'lower'],
      [3, 'upper'],
      [6, 'lower'],
    ]);
    expect(codes(result.week)).not.toContain('SCHEDULE_BACK_TO_BACK');
    expect(codes(plan(user({ trainingDays: [0, 1, 2] })).week)).toContain('SCHEDULE_BACK_TO_BACK');
  });

  it('hints a light dumbbell start from bodyweight, within the user’s dumbbells', () => {
    const u = user({
      location: 'HOME',
      goal: 'FAT_LOSS',
      equipment: [{ code: 'dumbbell', maxLoadKg: 6 }, { code: 'bench' }],
      bodyweightKg: 70,
    });
    const result = plan(u);
    const goblet = all(result.week).find((e) => e.exerciseId === 'goblet-squat')!;
    const row = all(result.week).find((e) => e.exerciseId === 'dumbbell-row')!;
    expect(goblet.loadHintKg).toBe(4); // 70 × 0.1 × 0.75 = 5.25 → 4 (2 kg steps)
    expect(row.loadHintKg).toBe(4);
    expect(
      plan({
        ...u,
        experience: 'INTERMEDIATE',
        equipment: [{ code: 'dumbbell', maxLoadKg: 6, incrementKg: 1 }, { code: 'bench' }],
      }).templateId,
    ).toBeDefined();
    const capped = plan({ ...u, bodyweightKg: 120, experience: 'INTERMEDIATE' });
    expect(all(capped.week).find((e) => e.exerciseId === 'goblet-squat')?.loadHintKg).toBe(6);
    expect(codes(result.week)).toContain('START_LIGHT');
    expect(
      all(plan({ ...u, bodyweightKg: null }).week).every((e) => e.loadHintKg === undefined),
    ).toBe(true);
  });

  it('gives no hint for dumbbell work that loads through other equipment', () => {
    const u = user({
      bodyweightKg: 80,
      equipment: [{ code: 'barbell' }, { code: 'dumbbell' }, { code: 'bench' }],
      goal: 'FAT_LOSS',
      location: 'HOME',
    });
    const odd = {
      ...ex('dumbbell-row'),
      id: 'barbell-dumbbell-row',
      slug: 'barbell-dumbbell-row',
      equipment: ['barbell', 'dumbbell'],
    };
    const t = template(
      'one',
      { goal: 'FAT_LOSS', experience: 'BEGINNER', location: 'HOME', split: 'full_body' },
      [
        [
          'A',
          'a',
          [
            ['barbell-dumbbell-row', 2, 8, 12, 7],
            ['plank', 2, 8, 12, 7],
          ],
        ],
        ['B', 'b', [['farmer-carry', 2, 8, 12, 7]]],
      ],
    );
    const result = plan(
      { ...u, trainingDays: [0, 3] },
      { exercises: [...EXERCISES, odd], templates: [t] },
    );
    expect(all(result.week).map((e) => e.loadHintKg)).toEqual([undefined, undefined, undefined]);
  });

  describe('safety (TC-ONB-2/3/4)', () => {
    it('caps RPE at 6 and bans heavy reps and plyometrics under intensityCap LOW', () => {
      const result = plan(
        user({
          goal: 'STRENGTH',
          experience: 'ADVANCED',
          trainingDays: [0, 1, 2, 3, 4, 5],
          intensityCap: 'LOW',
        }),
      );
      for (const e of all(result.week)) {
        expect(e.targetRpe).toBeLessThanOrEqual(6);
        expect(e.repMin).toBeGreaterThanOrEqual(6);
        expect(ex(e.exerciseId).contraindications).not.toContain('plyometric');
      }
      expect(codes(result.week)).toContain('INTENSITY_CAP_LOW');
    });

    it('excludes knee_high_load from moderate knee injuries up, not mild ones', () => {
      const knee = (severity: 'mild' | 'moderate') =>
        all(
          plan(
            user({
              goal: 'STRENGTH',
              experience: 'ADVANCED',
              trainingDays: [0, 1, 2, 3, 4, 5],
              conditions: [{ code: 'injury_knee', severity }],
            }),
          ).week,
        );
      expect(
        knee('moderate').some((e) => ex(e.exerciseId).contraindications.includes('knee_high_load')),
      ).toBe(false);
      expect(
        knee('mild').some((e) => ex(e.exerciseId).contraindications.includes('knee_high_load')),
      ).toBe(true);
    });

    it('applies pregnancy contraindications', () => {
      const result = plan(
        user({
          location: 'HOME',
          goal: 'FAT_LOSS',
          conditions: [{ code: 'pregnancy', severity: 'mild' }],
          intensityCap: 'LOW',
        }),
      );
      const tags = ['supine_after_t1', 'high_impact', 'valsalva_heavy', 'contact'];
      expect(
        all(result.week).some((e) =>
          ex(e.exerciseId).contraindications.some((t) => tags.includes(t)),
        ),
      ).toBe(false);
    });

    it('ignores conditions without a contraindication rule', () => {
      expect(plan(user({ conditions: [{ code: 'asthma', severity: 'severe' }] })).templateId).toBe(
        'fb-3-gym-beginner-general',
      );
    });
  });

  describe('fallbacks', () => {
    // A 31 min session fits 9 sets (30.5 min); a policy that allows 1 minute under rejects it.
    // The safe default's 8-set sessions (28 min) still pass.
    const strict = { ...DEFAULT_WORKOUT_POLICY, sessionOverrunMinutes: -1 };
    const short = user({
      goal: 'MUSCLE_GAIN',
      experience: 'INTERMEDIATE',
      trainingDays: [0, 1, 3, 4],
      sessionMinutes: 31,
    });

    it('falls back to the safe default template when the plan fails validation', () => {
      const result = plan(short, CATALOG, strict);
      expect(result).toMatchObject({ templateId: 'safe-default-full-body', fallback: true });
      expect(result.rejectedIssues.map((i) => i.rule)).toContain('SESSION_TOO_LONG');
      expect(result.week.rationale[0]).toEqual({
        code: 'PLAN_VALIDATION_FALLBACK',
        detail: { rejectedTemplateId: 'ul-4-gym-intermediate-hypertrophy' },
      });
      expect(result.week.sessions.map((s) => s.name)).toEqual([
        'Full body A',
        'Full body B',
        'Full body A',
        'Full body B',
      ]);
    });

    it('uses the safe default when no template matches', () => {
      const result = plan(user({ trainingDays: [0, 1, 2, 3, 4] }));
      expect(result).toMatchObject({ templateId: 'safe-default-full-body', fallback: false });
      expect(result.week.rationale[0]).toEqual({
        code: 'TEMPLATE_FALLBACK_GENERAL',
        detail: { templateId: 'safe-default-full-body' },
      });
    });

    it('reports errors when even the fallback cannot produce a plan', () => {
      const noSafe = { ...CATALOG, templates: TEMPLATES.filter((t) => t !== SAFE_DEFAULT) };
      expect(generatePlan(user({ trainingDays: [0, 1, 2, 3, 4] }), noSafe)).toEqual({
        ok: false,
        error: 'NO_TEMPLATE',
        issues: [],
      });
      expect(generatePlan(short, noSafe, strict)).toMatchObject({
        ok: false,
        error: 'PLAN_INVALID',
      });
      const drafts = {
        ...CATALOG,
        exercises: EXERCISES.map((e) => ({ ...e, status: 'DRAFT' as const })),
      };
      expect(generatePlan(user(), drafts)).toEqual({ ok: false, error: 'NO_ELIGIBLE_EXERCISES' });
      const tight = { ...DEFAULT_WORKOUT_POLICY, sessionOverrunMinutes: -20 };
      expect(generatePlan(short, CATALOG, tight)).toMatchObject({
        ok: false,
        error: 'PLAN_INVALID',
      });
    });
  });
});
