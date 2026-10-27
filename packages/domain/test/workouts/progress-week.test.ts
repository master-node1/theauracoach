import { describe, expect, it } from 'vitest';
import {
  progressWeek,
  type PlannedExercise,
  type PlanWeek,
  type ProgressWeekInput,
  type ProgressWeekResult,
  type SessionLog,
} from '../../src/workouts';
import { EXERCISE_MAP, GYM_EQUIPMENT } from './fixtures';
import { log, pe, sets, week } from './helpers';

// Weekly adaptation, rule by rule (workouts LLD §4, TC-WO-1..6).

function run(
  overrides: Partial<ProgressWeekInput> & { week: PlanWeek; logs: SessionLog[] },
): ProgressWeekResult {
  return progressWeek({
    user: {
      experience: 'INTERMEDIATE',
      intensityCap: 'STANDARD',
      equipment: GYM_EQUIPMENT,
      conditions: [],
      sessionMinutes: 60,
    },
    catalog: EXERCISE_MAP,
    history: { fatigueWeeksInRow: 0, missedWeeksInRow: 0, painReports: [] },
    recovery: {},
    weekStart: '2026-11-09',
    ...overrides,
  });
}

/** A two-day week: `subject` on Monday, a filler on Wednesday that is always logged. */
function oneExercise(
  subject: PlannedExercise,
  mondaySets: SessionLog['sets'],
  extra: Partial<ProgressWeekInput> = {},
) {
  const w = week([
    [0, [subject]],
    [2, [pe('plank', { sets: 2 })]],
  ]);
  const result = run({
    week: w,
    logs: [log(0, mondaySets), log(2, sets('plank', 2, 8, null))],
    ...extra,
  });
  return {
    result,
    next: result.week.sessions[0]!.exercises[0]!,
    codes: result.week.rationale.filter((r) => r.dayOfWeek !== 2).map((r) => r.code),
  };
}

const squat = (o: Partial<PlannedExercise> = {}) =>
  pe('barbell-back-squat', { targetLoadKg: 20, targetRpe: 8, ...o });

describe('double progression (TC-WO-1)', () => {
  it('adds the barbell increment and resets reps after 3 × 12 at RPE ≤ target', () => {
    const { next, codes } = oneExercise(
      squat({ targetReps: 12 }),
      sets('barbell-back-squat', 3, 12, 20, 8),
    );
    expect(next).toMatchObject({ targetLoadKg: 22.5, targetReps: 8, sets: 3 });
    expect(codes).toEqual(['PROGRESS_LOAD']);
  });

  it.each([
    ['goblet-squat', GYM_EQUIPMENT, 20, 22],
    ['leg-press', GYM_EQUIPMENT, 100, 105],
    ['barbell-back-squat', [{ code: 'barbell', incrementKg: 1.25 }], 20, 21.25],
    ['barbell-back-squat', GYM_EQUIPMENT, 21, 22.5],
  ])('%s steps from the right increment', (id, equipment, from, to) => {
    const { next } = oneExercise(
      pe(id, { targetLoadKg: from, targetRpe: 8 }),
      sets(id, 3, 12, from, 8),
      {
        user: {
          experience: 'INTERMEDIATE',
          intensityCap: 'STANDARD',
          equipment,
          conditions: [],
          sessionMinutes: 60,
        },
      },
    );
    expect(next.targetLoadKg).toBe(to);
  });

  it('treats a set without RPE as at target, and uses the logged load when none was prescribed', () => {
    const { next } = oneExercise(squat({ targetLoadKg: null }), [
      ...sets('barbell-back-squat', 2, 12, 20, null),
      ...sets('barbell-back-squat', 1, 12, null, 8),
    ]);
    expect(next.targetLoadKg).toBe(22.5);
  });

  it('holds and aims for the top of the range when a loadable exercise was logged without load', () => {
    const { next, codes } = oneExercise(
      squat({ targetLoadKg: null }),
      sets('barbell-back-squat', 3, 12, null, 8),
    );
    expect(next).toMatchObject({ targetLoadKg: null, targetReps: 12 });
    expect(codes).toEqual(['HOLD_REPS']);
  });
});

describe('when load cannot go up (TC-WO-2)', () => {
  const capped = [
    ...GYM_EQUIPMENT.filter((e) => e.code !== 'dumbbell'),
    { code: 'dumbbell', maxLoadKg: 20 },
  ];
  const u = (
    equipment = capped,
    experience: 'BEGINNER' | 'INTERMEDIATE' = 'INTERMEDIATE',
    sessionMinutes = 60,
  ) => ({
    user: {
      experience,
      intensityCap: 'STANDARD' as const,
      equipment,
      conditions: [],
      sessionMinutes,
    },
  });
  const goblet = (o: Partial<PlannedExercise> = {}) =>
    pe('goblet-squat', { targetLoadKg: 20, targetRpe: 8, ...o });
  const topped = (n = 3) => sets('goblet-squat', n, 12, 20, 7);

  it('adds a set at the max dumbbell', () => {
    const { next, codes } = oneExercise(goblet(), topped(), u());
    expect(next).toMatchObject({ sets: 4, baseSets: 3, targetLoadKg: 20 });
    expect(codes).toEqual(['PROGRESS_ADD_SET']);
  });

  it('moves to the progression exercise after +2 sets', () => {
    const { next, codes } = oneExercise(goblet({ sets: 5, baseSets: 3 }), topped(5), u());
    expect(next).toMatchObject({
      exerciseId: 'barbell-back-squat',
      sets: 3,
      targetLoadKg: null,
      targetReps: 8,
    });
    expect(codes).toEqual(['PROGRESS_EXERCISE']);
  });

  it('holds when the progression is not available to the user', () => {
    const { next, codes } = oneExercise(
      goblet({ sets: 5, baseSets: 3 }),
      topped(5),
      u(capped, 'BEGINNER'),
    );
    expect(next).toMatchObject({ exerciseId: 'goblet-squat', sets: 5, targetLoadKg: 20 });
    expect(codes).toEqual(['HOLD_MAX_REACHED']);
  });

  it('does not add a set the session has no time for', () => {
    // 8 + 2.5 × (3 + 3) = 23 min; one more set makes 25.5, over the 15 + 10 allowed.
    const w = week([
      [0, [goblet(), pe('plank', { sets: 3 })]],
      [2, [pe('plank')]],
    ]);
    const logs = [
      log(0, [...topped(), ...sets('plank', 3, 8, null)]),
      log(2, sets('plank', 3, 8, null)),
    ];
    const result = run({ week: w, logs, ...u(capped, 'INTERMEDIATE', 15) });
    expect(result.week.rationale[0]).toMatchObject({
      code: 'PROGRESS_EXERCISE',
      exerciseId: 'goblet-squat',
    });
  });

  it('does not push a muscle over the weekly maximum', () => {
    const w = week([
      [
        0,
        [
          pe('push-up', { targetRpe: 8 }),
          pe('machine-chest-press', { sets: 11, targetLoadKg: 40 }),
        ],
      ],
      [2, [pe('plank')]],
    ]);
    const result = run({
      week: w,
      logs: [
        log(0, [...sets('push-up', 3, 12, null, 7), ...sets('machine-chest-press', 11, 9, 40, 8)]),
        log(2, sets('plank', 3, 8, null)),
      ],
    });
    expect(result.week.sessions[0]!.exercises[0]).toMatchObject({ exerciseId: 'push-up', sets: 3 });
    expect(result.week.rationale.map((r) => r.code)).toEqual([
      'HOLD_MAX_REACHED',
      'HOLD_REPS',
      'HOLD_REPS',
    ]);
  });

  it('adds sets to bodyweight exercises and holds unknown exercises', () => {
    const w = week([
      [0, [pe('push-up', { targetRpe: 8 }), pe('ghost', { targetRpe: 8 })]],
      [2, [pe('plank')]],
    ]);
    const result = run({
      week: w,
      logs: [
        log(0, [...sets('push-up', 3, 12, null, 7), ...sets('ghost', 3, 12, null, 7)]),
        log(2, sets('plank', 3, 8, null)),
      ],
    });
    expect(result.week.sessions[0]!.exercises.map((e) => e.sets)).toEqual([4, 3]);
    expect(result.week.rationale.map((r) => r.code).slice(0, 2)).toEqual([
      'PROGRESS_ADD_SET',
      'HOLD_MAX_REACHED',
    ]);
  });
});

describe('hold and regress (TC-WO-3)', () => {
  it('keeps the load when only 2 of 3 sets were done', () => {
    const { next, codes } = oneExercise(squat(), sets('barbell-back-squat', 2, 10, 20, 8));
    expect(next).toMatchObject({ targetLoadKg: 20, sets: 3 });
    expect(codes).toEqual(['HOLD_INCOMPLETE']);
  });

  it('keeps the load and adds a rep inside the range', () => {
    expect(oneExercise(squat(), sets('barbell-back-squat', 3, 10, 20, 8)).next).toMatchObject({
      targetLoadKg: 20,
      targetReps: 9,
    });
    expect(
      oneExercise(squat({ targetReps: 12 }), sets('barbell-back-squat', 3, 11, 20, 8)).next
        .targetReps,
    ).toBe(12);
  });

  it('holds when the top of the range came above the target RPE', () => {
    expect(oneExercise(squat(), sets('barbell-back-squat', 3, 12, 20, 9)).codes).toEqual([
      'HOLD_REPS',
    ]);
  });

  it('ignores warm-ups, sets without reps and other exercises', () => {
    const logged = [
      ...sets('barbell-back-squat', 2, 12, 10, 5, { isWarmup: true }),
      ...sets('barbell-back-squat', 1, null, 20),
      ...sets('goblet-squat', 3, 12, 16),
    ];
    expect(oneExercise(squat(), logged).codes).toEqual(['HOLD_NOT_PERFORMED']);
  });

  it('cuts the load 10% (down to the increment) below half the prescribed reps', () => {
    const { next, codes } = oneExercise(squat(), sets('barbell-back-squat', 1, 5, 20, null));
    expect(next).toMatchObject({ targetLoadKg: 17.5, targetReps: 8 });
    expect(codes).toEqual(['REGRESS_LOAD']);
  });

  it('regresses when the first set is already at RPE 9.5', () => {
    const logged = [
      ...sets('barbell-back-squat', 1, 8, 20, 9.5).map((s) => ({ ...s, setNumber: 1 })),
      ...sets('barbell-back-squat', 2, 8, 20, 8).map((s) => ({ ...s, setNumber: s.setNumber + 1 })),
    ];
    expect(oneExercise(squat(), logged.reverse()).codes).toEqual(['REGRESS_LOAD']);
  });

  it('regresses reps only when there is no load, and scales loads with no increment', () => {
    expect(oneExercise(pe('push-up'), sets('push-up', 1, 3, null)).next).toMatchObject({
      targetLoadKg: null,
      targetReps: 8,
    });
    expect(oneExercise(pe('push-up'), sets('push-up', 1, 3, 10)).next.targetLoadKg).toBe(9);
  });
});

describe('missed sessions (TC-WO-4)', () => {
  const three = (subject: PlannedExercise) =>
    week([
      [0, [subject]],
      [2, [pe('plank')]],
      [4, [pe('plank')]],
    ]);

  it('keeps every prescription after 2 missed sessions and never stacks volume', () => {
    const w = three(squat());
    const result = run({
      week: w,
      logs: [log(0, sets('barbell-back-squat', 3, 12, 20, 7)), log(2, [], { status: 'MISSED' })],
    });
    expect(result.week.sessions).toHaveLength(3);
    expect(result.week.sessions.map((s) => s.exercises.map((e) => e.sets))).toEqual([
      [3],
      [3],
      [3],
    ]);
    expect(result.week.sessions[0]!.exercises[0]).toMatchObject({ targetLoadKg: 20 });
    expect(result.week.rationale).toEqual([{ code: 'HOLD_MISSED', detail: { missed: 2 } }]);
    expect(result.history.missedWeeksInRow).toBe(1);
  });

  it('counts skipped and still-planned sessions as missed', () => {
    const result = run({
      week: three(squat()),
      logs: [log(0, []), log(2, [], { status: 'SKIPPED' }), log(4, [], { status: 'PLANNED' })],
    });
    expect(result.week.rationale[0]).toMatchObject({ code: 'HOLD_MISSED', detail: { missed: 2 } });
  });

  it('proposes one training day fewer after the third such week', () => {
    const history = { fatigueWeeksInRow: 0, missedWeeksInRow: 2, painReports: [] };
    const result = run({ week: three(squat()), logs: [], history });
    expect(result.recommendations).toEqual([
      { kind: 'REDUCE_TRAINING_DAYS', detail: { fromDays: 3, toDays: 2 } },
    ]);
    expect(result.history.missedWeeksInRow).toBe(0);
  });

  it('never proposes fewer than two days', () => {
    const history = { fatigueWeeksInRow: 0, missedWeeksInRow: 2, painReports: [] };
    const result = run({
      week: week([
        [0, [squat()]],
        [2, [pe('plank')]],
      ]),
      logs: [],
      history,
    });
    expect(result.recommendations).toEqual([]);
    expect(result.history.missedWeeksInRow).toBe(0);
  });

  it('resets the streak after a week with at most one miss', () => {
    const history = { fatigueWeeksInRow: 0, missedWeeksInRow: 2, painReports: [] };
    const result = run({
      week: three(squat()),
      logs: [log(0, []), log(2, [], { status: 'IN_PROGRESS' })],
      history,
    });
    expect(result.history.missedWeeksInRow).toBe(0);
    expect(result.week.rationale.map((r) => r.code)).toEqual([
      'HOLD_NOT_PERFORMED',
      'HOLD_NOT_PERFORMED',
      'HOLD_NOT_PERFORMED',
    ]);
  });
});

describe('deload (TC-WO-5)', () => {
  const tired = (day: number, s: SessionLog['sets']) =>
    log(day, s, { perceivedDifficulty: 9, soreness: 4 });
  const plan = () =>
    week([
      [
        0,
        [
          squat({ sets: 4 }),
          pe('dumbbell-bench-press', { sets: 3, targetRpe: 8, targetLoadKg: 16 }),
        ],
      ],
      [
        2,
        [
          pe('barbell-rdl', { sets: 3, targetLoadKg: 40 }),
          pe('seated-cable-row', { sets: 3, targetLoadKg: 30 }),
        ],
      ],
    ]);
  const tiredLogs = () => [tired(0, sets('barbell-back-squat', 4, 12, 20, 7)), tired(2, [])];

  it('counts the first fatigued week without deloading', () => {
    const result = run({ week: plan(), logs: tiredLogs() });
    expect(result.week.kind).toBe('NORMAL');
    expect(result.history.fatigueWeeksInRow).toBe(1);
  });

  it('deloads after 2 fatigued weeks: 40–60% fewer sets, same load, RPE −2', () => {
    const before = plan();
    const result = run({
      week: before,
      logs: tiredLogs(),
      history: { fatigueWeeksInRow: 1, missedWeeksInRow: 0, painReports: [] },
    });
    const total = (w: PlanWeek) =>
      w.sessions.flatMap((s) => s.exercises).reduce((n, e) => n + e.sets, 0);
    expect(result.week.kind).toBe('DELOAD');
    expect(result.week.rationale).toEqual([
      { code: 'DELOAD_FATIGUE', detail: { volumeShare: 0.55 } },
    ]);
    const kept = total(result.week) / total(before);
    expect(kept).toBeGreaterThanOrEqual(0.4);
    expect(kept).toBeLessThanOrEqual(0.6);
    expect(result.week.sessions[0]!.exercises[0]).toMatchObject({ targetLoadKg: 20, targetRpe: 6 });
    expect(result.history.fatigueWeeksInRow).toBe(0);
  });

  it('drops single-set exercises when the deload share leaves them nothing', () => {
    const w = week([
      [0, ['plank', 'dead-bug', 'push-up', 'doorway-row'].map((id) => pe(id, { sets: 1 }))],
      [2, [pe('plank', { sets: 1 })]],
    ]);
    const result = run({
      week: w,
      logs: [tired(0, []), tired(2, [])],
      history: { fatigueWeeksInRow: 1, missedWeeksInRow: 0, painReports: [] },
    });
    expect(
      result.week.sessions.flatMap((s) => s.exercises.map((e) => [e.order, e.exerciseId])),
    ).toEqual([
      [1, 'plank'],
      [2, 'dead-bug'],
      [3, 'push-up'],
    ]);
  });

  it('is not triggered by fatigue without session ratings', () => {
    const logs = [
      log(0, [], { perceivedDifficulty: null, soreness: 5 }),
      log(2, [], { soreness: null }),
    ];
    expect(
      run({
        week: plan(),
        logs,
        history: { fatigueWeeksInRow: 1, missedWeeksInRow: 0, painReports: [] },
      }).week.kind,
    ).toBe('NORMAL');
  });

  it('is scheduled every 6th week for intermediate and advanced users, never beginners', () => {
    const w = { ...plan(), weekIndex: 4 };
    const logs = [log(0, []), log(2, [])];
    expect(run({ week: w, logs }).week).toMatchObject({
      kind: 'DELOAD',
      weekIndex: 5,
      rationale: [{ code: 'DELOAD_SCHEDULED' }],
    });
    const beginner = {
      experience: 'BEGINNER' as const,
      intensityCap: 'STANDARD' as const,
      equipment: GYM_EQUIPMENT,
      conditions: [],
      sessionMinutes: 60,
    };
    expect(run({ week: w, logs, user: beginner }).week.kind).toBe('NORMAL');
  });

  it('returns to the last normal week after a deload', () => {
    const normal = plan();
    const deload: PlanWeek = { ...plan(), kind: 'DELOAD', weekIndex: 5 };
    const result = run({
      week: deload,
      lastNormalWeek: normal,
      logs: tiredLogs(),
      history: { fatigueWeeksInRow: 1, missedWeeksInRow: 0, painReports: [] },
    });
    expect(result.week).toMatchObject({
      kind: 'NORMAL',
      weekIndex: 6,
      sessions: normal.sessions,
      rationale: [{ code: 'RESUME_AFTER_DELOAD' }],
    });
    expect(() => run({ week: deload, logs: [] })).toThrow(/lastNormalWeek/);
  });
});

describe('pain (TC-WO-6)', () => {
  const pain = (id: string, load: number | null = 20) =>
    sets(id, 3, 10, load, 7, { painReported: true });

  it('swaps to the regression next week', () => {
    const { next, codes, result } = oneExercise(squat(), pain('barbell-back-squat'));
    expect(next).toMatchObject({
      exerciseId: 'goblet-squat',
      substitutedFromId: 'barbell-back-squat',
      targetLoadKg: null,
      targetReps: 8,
    });
    expect(codes).toEqual(['PAIN_REGRESSION']);
    expect(result.recommendations).toEqual([]);
    expect(result.history.painReports).toEqual([
      { exerciseId: 'barbell-back-squat', date: '2026-11-02' },
    ]);
  });

  it('cuts the load when there is no usable regression', () => {
    const noDumbbells = GYM_EQUIPMENT.filter((e) => e.code !== 'dumbbell');
    const user = {
      experience: 'INTERMEDIATE' as const,
      intensityCap: 'STANDARD' as const,
      equipment: noDumbbells,
      conditions: [],
      sessionMinutes: 60,
    };
    const deadlift = oneExercise(
      pe('barbell-deadlift', { targetLoadKg: 60 }),
      pain('barbell-deadlift', 60),
      { user },
    );
    expect(deadlift.next).toMatchObject({ exerciseId: 'barbell-deadlift', targetLoadKg: 52.5 });
    expect(deadlift.codes).toEqual(['PAIN_LOAD_REDUCED']);
    expect(oneExercise(pe('plank'), pain('plank', null)).next.targetLoadKg).toBeNull();
    expect(
      oneExercise(pe('ghost', { targetLoadKg: 10 }), pain('ghost', 10)).next.targetLoadKg,
    ).toBe(9);
  });

  it('proposes professional advice on the second report in 14 days', () => {
    const history = {
      fatigueWeeksInRow: 0,
      missedWeeksInRow: 0,
      painReports: [{ exerciseId: 'push-up', date: '2026-10-27' }],
    };
    const { result } = oneExercise(squat(), pain('barbell-back-squat'), { history });
    expect(result.recommendations).toEqual([
      {
        kind: 'PROFESSIONAL_ADVICE',
        exerciseId: 'barbell-back-squat',
        detail: { reports: 2, windowDays: 14 },
      },
    ]);
  });

  it('forgets reports older than 14 days and needs a report this week', () => {
    const old = {
      fatigueWeeksInRow: 0,
      missedWeeksInRow: 0,
      painReports: [{ exerciseId: 'push-up', date: '2026-10-20' }],
    };
    const fresh = oneExercise(squat(), pain('barbell-back-squat'), { history: old });
    expect(fresh.result.recommendations).toEqual([]);
    expect(fresh.result.history.painReports).toHaveLength(1);
    const twoOld = {
      ...old,
      painReports: [
        { exerciseId: 'a', date: '2026-11-01' },
        { exerciseId: 'b', date: '2026-11-02' },
      ],
    };
    expect(
      oneExercise(squat(), sets('barbell-back-squat', 3, 10, 20), { history: twoOld }).result
        .recommendations,
    ).toEqual([]);
  });

  it('applies on deload and resumed weeks too', () => {
    const w = {
      ...week([
        [0, [squat()]],
        [2, [pe('plank')]],
      ]),
      weekIndex: 4,
    };
    const logs = [log(0, pain('barbell-back-squat')), log(2, [])];
    expect(run({ week: w, logs }).week.sessions[0]!.exercises[0]!.exerciseId).toBe('goblet-squat');
    const resumed = run({ week: { ...w, kind: 'DELOAD' }, lastNormalWeek: w, logs });
    expect(resumed.week.sessions[0]!.exercises[0]!.exerciseId).toBe('goblet-squat');
  });
});

describe('recovery modifiers', () => {
  it.each([[{ avgSleepHours: 5.5 }], [{ avgEnergy: 2 }]])(
    'blocks load increases for %o',
    (recovery) => {
      const { next, codes } = oneExercise(squat(), sets('barbell-back-squat', 3, 12, 20, 7), {
        recovery,
      });
      expect(next.targetLoadKg).toBe(20);
      expect(codes).toEqual(['HOLD_RECOVERY']);
    },
  );

  it('allows them with enough sleep and energy', () => {
    const { codes } = oneExercise(squat(), sets('barbell-back-squat', 3, 12, 20, 7), {
      recovery: { avgSleepHours: 7, avgEnergy: 3 },
    });
    expect(codes).toEqual(['PROGRESS_LOAD']);
  });

  it('uses the default policy when none is passed', () => {
    const w = week([
      [0, [squat()]],
      [2, [pe('plank')]],
    ]);
    expect(
      progressWeek({
        week: w,
        logs: [],
        user: {
          experience: 'BEGINNER',
          intensityCap: 'LOW',
          equipment: [],
          conditions: [],
          sessionMinutes: 30,
        },
        catalog: EXERCISE_MAP,
        history: { fatigueWeeksInRow: 0, missedWeeksInRow: 0, painReports: [] },
        recovery: {},
        weekStart: '2026-11-09',
      }).week.weekIndex,
    ).toBe(1);
  });
});
