import type { LoggedSet, PlannedExercise, PlanWeek, SessionLog } from '../../src/workouts';

export function pe(exerciseId: string, overrides: Partial<PlannedExercise> = {}): PlannedExercise {
  return {
    order: 1,
    exerciseId,
    sets: 3,
    repMin: 8,
    repMax: 12,
    targetLoadKg: null,
    targetRpe: 7,
    restSec: 90,
    ...overrides,
  };
}

export function week(
  sessions: [dayOfWeek: number, exercises: PlannedExercise[]][],
  overrides: Partial<PlanWeek> = {},
): PlanWeek {
  return {
    weekIndex: 0,
    kind: 'NORMAL',
    templateId: 't',
    rationale: [],
    sessions: sessions.map(([dayOfWeek, exercises]) => ({
      dayOfWeek,
      name: `Day ${dayOfWeek}`,
      focus: 'full body',
      exercises: exercises.map((e, i) => ({ ...e, order: i + 1 })),
    })),
    ...overrides,
  };
}

/** `n` working sets of `reps` at `loadKg` and `rpe`. */
export function sets(
  exerciseId: string,
  n: number,
  reps: number | null,
  loadKg: number | null,
  rpe: number | null = 7,
  extra: Partial<LoggedSet> = {},
): LoggedSet[] {
  return Array.from({ length: n }, (_, i) => ({
    exerciseId,
    setNumber: i + 1,
    reps,
    loadKg,
    rpe,
    ...extra,
  }));
}

export function log(
  dayOfWeek: number,
  loggedSets: LoggedSet[],
  overrides: Partial<SessionLog> = {},
): SessionLog {
  return {
    dayOfWeek,
    date: `2026-11-0${dayOfWeek + 2}`,
    status: 'COMPLETED',
    perceivedDifficulty: 7,
    soreness: 2,
    sets: loggedSets,
    ...overrides,
  };
}
