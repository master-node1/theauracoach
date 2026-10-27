import {
  availableEquipment,
  excludedTags,
  ineligibility,
  isHeavyHinge,
  type IneligibleReason,
} from './eligibility';
import { DEFAULT_WORKOUT_POLICY, type WorkoutPolicy } from './policy';
import type { Exercise, PlanWeek, PlannedExercise, UserTrainingInput } from './types';

// Plan safety rules (workouts LLD §3 "Validation rules"). Generated plans, coach proposals and
// published templates all pass through here before anything is stored.

export const VALIDATION_RULES = [
  'UNKNOWN_EXERCISE',
  'EXERCISE_NOT_PUBLISHED',
  'EQUIPMENT_UNAVAILABLE',
  'DIFFICULTY_ABOVE_EXPERIENCE',
  'CONTRAINDICATED_EXERCISE',
  'INVALID_PRESCRIPTION',
  'RPE_ABOVE_CAP',
  'LOW_CAP_HEAVY_REPS',
  'INVALID_DAY',
  'SESSIONS_SAME_DAY',
  'SESSION_TOO_LONG',
  'WEEKLY_VOLUME_ABOVE_MAX',
  'BEGINNER_HINGE_FREQUENCY',
] as const;
export type ValidationRule = (typeof VALIDATION_RULES)[number];

export interface ValidationIssue {
  rule: ValidationRule;
  /** Index into `week.sessions`. */
  session?: number;
  exerciseId?: string;
  muscle?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const INELIGIBLE_RULE: Record<IneligibleReason, ValidationRule> = {
  NOT_PUBLISHED: 'EXERCISE_NOT_PUBLISHED',
  EQUIPMENT: 'EQUIPMENT_UNAVAILABLE',
  DIFFICULTY: 'DIFFICULTY_ABOVE_EXPERIENCE',
  CONTRAINDICATED: 'CONTRAINDICATED_EXERCISE',
};

/** Minutes a session takes: warm-up plus a fixed time per set including rest. */
export function estimateSessionMinutes(
  exercises: Pick<PlannedExercise, 'sets'>[],
  policy: WorkoutPolicy = DEFAULT_WORKOUT_POLICY,
): number {
  const sets = exercises.reduce((n, e) => n + e.sets, 0);
  return policy.warmupMinutes + sets * policy.minutesPerSet;
}

/** Hard sets per primary muscle across the week. */
export function weeklySetsByMuscle(
  week: PlanWeek,
  exercises: ReadonlyMap<string, Exercise>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const session of week.sessions) {
    for (const pe of session.exercises) {
      const ex = exercises.get(pe.exerciseId);
      for (const m of ex?.primaryMuscles ?? []) totals.set(m, (totals.get(m) ?? 0) + pe.sets);
    }
  }
  return totals;
}

function validPrescription(pe: PlannedExercise): boolean {
  return (
    Number.isInteger(pe.sets) &&
    pe.sets >= 1 &&
    Number.isInteger(pe.repMin) &&
    Number.isInteger(pe.repMax) &&
    pe.repMin >= 1 &&
    pe.repMin <= pe.repMax &&
    pe.restSec >= 0 &&
    (pe.targetLoadKg === null || pe.targetLoadKg >= 0) &&
    (pe.targetReps === undefined || (pe.targetReps >= pe.repMin && pe.targetReps <= pe.repMax))
  );
}

export function validatePlan(
  week: PlanWeek,
  input: UserTrainingInput,
  catalog: ReadonlyMap<string, Exercise>,
  policy: WorkoutPolicy = DEFAULT_WORKOUT_POLICY,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const ctx = {
    available: availableEquipment(input.equipment),
    excluded: excludedTags(input.conditions, input.intensityCap, policy),
    experience: input.experience,
  };
  const low = input.intensityCap === 'LOW';
  const rpeCap = low ? policy.lowCapMaxRpe : 10;
  const days = new Set<number>();
  let heavyHingeSessions = 0;

  week.sessions.forEach((session, s) => {
    if (!Number.isInteger(session.dayOfWeek) || session.dayOfWeek < 0 || session.dayOfWeek > 6) {
      issues.push({ rule: 'INVALID_DAY', session: s });
    } else if (days.has(session.dayOfWeek)) {
      issues.push({ rule: 'SESSIONS_SAME_DAY', session: s });
    }
    days.add(session.dayOfWeek);

    if (
      estimateSessionMinutes(session.exercises, policy) >
      input.sessionMinutes + policy.sessionOverrunMinutes
    ) {
      issues.push({ rule: 'SESSION_TOO_LONG', session: s });
    }

    let heavyHinge = false;
    for (const pe of session.exercises) {
      const at = { session: s, exerciseId: pe.exerciseId };
      if (!validPrescription(pe)) issues.push({ rule: 'INVALID_PRESCRIPTION', ...at });
      if (pe.targetRpe > rpeCap) issues.push({ rule: 'RPE_ABOVE_CAP', ...at });
      if (low && pe.repMin < policy.lowCapMinReps)
        issues.push({ rule: 'LOW_CAP_HEAVY_REPS', ...at });

      const ex = catalog.get(pe.exerciseId);
      if (!ex) {
        issues.push({ rule: 'UNKNOWN_EXERCISE', ...at });
        continue;
      }
      const reason = ineligibility(ex, ctx);
      if (reason) issues.push({ rule: INELIGIBLE_RULE[reason], ...at });
      if (isHeavyHinge(ex)) heavyHinge = true;
    }
    if (heavyHinge) heavyHingeSessions += 1;
  });

  const bounds = policy.weeklySetsPerMuscle[input.experience];
  for (const [muscle, sets] of weeklySetsByMuscle(week, catalog)) {
    if (sets > bounds.max) issues.push({ rule: 'WEEKLY_VOLUME_ABOVE_MAX', muscle });
  }

  if (
    input.experience === 'BEGINNER' &&
    heavyHingeSessions > policy.beginnerHeavyHingeSessionsPerWeek
  ) {
    issues.push({ rule: 'BEGINNER_HINGE_FREQUENCY' });
  }

  return { valid: issues.length === 0, issues };
}
