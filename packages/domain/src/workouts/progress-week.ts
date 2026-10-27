import {
  availableEquipment,
  excludedTags,
  ineligibility,
  type EligibilityContext,
} from './eligibility';
import { addKg, loadEquipment, roundToIncrement } from './load';
import { DEFAULT_WORKOUT_POLICY, type WorkoutPolicy } from './policy';
import type {
  Exercise,
  LoggedSet,
  PlannedExercise,
  PlannedSession,
  PlanWeek,
  RationaleEntry,
  SessionLog,
  UserTrainingInput,
  WorkoutRecommendation,
} from './types';
import { estimateSessionMinutes, weeklySetsByMuscle } from './validate-plan';

// Weekly adaptation (workouts LLD §4). Takes the week that just finished and what the user logged,
// returns next week's prescriptions with a rationale code for every change.

export interface PainReport {
  exerciseId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
}

/** Counters carried between weeks; workout-service stores the returned copy. */
export interface ProgressHistory {
  /** Consecutive finished weeks, before this one, that met the fatigue criteria. */
  fatigueWeeksInRow: number;
  /** Consecutive finished weeks, before this one, with two or more missed sessions. */
  missedWeeksInRow: number;
  /** Pain reports inside the pain window before this week. */
  painReports: PainReport[];
}

export interface RecoverySummary {
  avgSleepHours?: number | null;
  avgEnergy?: number | null;
}

export interface ProgressWeekInput {
  /** The week that just finished. */
  week: PlanWeek;
  /** The last NORMAL week; required when `week` was a deload, so its prescriptions come back. */
  lastNormalWeek?: PlanWeek;
  logs: SessionLog[];
  user: Pick<
    UserTrainingInput,
    'experience' | 'intensityCap' | 'equipment' | 'conditions' | 'sessionMinutes'
  >;
  catalog: ReadonlyMap<string, Exercise>;
  history: ProgressHistory;
  recovery: RecoverySummary;
  /** ISO date the new week starts. */
  weekStart: string;
}

export interface ProgressWeekResult {
  week: PlanWeek;
  recommendations: WorkoutRecommendation[];
  history: ProgressHistory;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const PERFORMED = new Set(['COMPLETED', 'PARTIAL', 'IN_PROGRESS']);

function mean(values: (number | null | undefined)[]): number | null {
  const xs = values.filter((v): v is number => typeof v === 'number');
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/** Splits `total` sets across exercises in proportion to their current sets (largest remainder). */
function deloadSets(sessions: PlannedSession[], share: number): void {
  const all = sessions.flatMap((s) => s.exercises);
  const total = all.reduce((n, e) => n + e.sets, 0);
  const target = Math.round(total * share);
  const quotas = all.map((e) => e.sets * share);
  const alloc = quotas.map(Math.floor);
  let left = target - alloc.reduce((a, b) => a + b, 0);
  const byRemainder = quotas
    .map((q, i) => ({ i, r: q - Math.floor(q) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    alloc[i]! += 1;
    left -= 1;
  }
  all.forEach((e, i) => (e.sets = alloc[i]!));
  for (const s of sessions) {
    s.exercises = s.exercises.filter((e) => e.sets > 0);
    s.exercises.forEach((e, i) => (e.order = i + 1));
  }
}

function clone(week: PlanWeek): PlannedSession[] {
  return week.sessions.map((s) => ({ ...s, exercises: s.exercises.map((e) => ({ ...e })) }));
}

export function progressWeek(
  input: ProgressWeekInput,
  policy: WorkoutPolicy = DEFAULT_WORKOUT_POLICY,
): ProgressWeekResult {
  const { week, logs, user, catalog, history, recovery } = input;
  const rationale: RationaleEntry[] = [];
  const recommendations: WorkoutRecommendation[] = [];
  const eligibility: EligibilityContext = {
    available: availableEquipment(user.equipment),
    excluded: excludedTags(user.conditions, user.intensityCap, policy),
    experience: user.experience,
  };
  const usable = (id: string | null | undefined): Exercise | undefined => {
    const ex = id ? catalog.get(id) : undefined;
    return ex && ineligibility(ex, eligibility) === null ? ex : undefined;
  };

  // Week-level signals.
  const logByDay = new Map(logs.map((l) => [l.dayOfWeek, l]));
  const performed = logs.filter((l) => PERFORMED.has(l.status));
  const avgRpe = mean(performed.map((l) => l.perceivedDifficulty));
  const avgSoreness = mean(performed.map((l) => l.soreness));
  const fatigued = avgRpe !== null && avgSoreness !== null && avgRpe >= 9 && avgSoreness >= 4;
  let fatigueWeeksInRow = fatigued ? history.fatigueWeeksInRow + 1 : 0;

  const missed = week.sessions.filter((s) => {
    const status = logByDay.get(s.dayOfWeek)?.status;
    return (
      status === undefined || status === 'MISSED' || status === 'SKIPPED' || status === 'PLANNED'
    );
  }).length;
  const missedHeavy = missed >= 2;
  let missedWeeksInRow = missedHeavy ? history.missedWeeksInRow + 1 : 0;
  const recoveryLimited =
    (recovery.avgSleepHours != null && recovery.avgSleepHours < 6) ||
    (recovery.avgEnergy != null && recovery.avgEnergy <= 2);

  // Pain reports in the window, and the professional-advice proposal on the second one.
  const start = dayNumber(input.weekStart);
  const painThisWeek: PainReport[] = [];
  for (const log of logs) {
    for (const ex of new Set(log.sets.filter((s) => s.painReported).map((s) => s.exerciseId))) {
      painThisWeek.push({ exerciseId: ex, date: log.date });
    }
  }
  const painReports = [...history.painReports, ...painThisWeek].filter(
    (p) => start - dayNumber(p.date) <= policy.painReportWindowDays,
  );
  const painful = new Set(painThisWeek.map((p) => p.exerciseId));
  if (painThisWeek.length > 0 && painReports.length >= 2) {
    recommendations.push({
      kind: 'PROFESSIONAL_ADVICE',
      exerciseId: painThisWeek[0]!.exerciseId,
      detail: { reports: painReports.length, windowDays: policy.painReportWindowDays },
    });
  }

  const resuming = week.kind === 'DELOAD';
  if (resuming && !input.lastNormalWeek)
    throw new Error('lastNormalWeek is required after a deload week');
  const base = resuming ? input.lastNormalWeek! : week;
  const nextIndex = week.weekIndex + 1;

  let deload: 'DELOAD_FATIGUE' | 'DELOAD_SCHEDULED' | null = null;
  if (!resuming && fatigueWeeksInRow >= 2) deload = 'DELOAD_FATIGUE';
  else if (
    !resuming &&
    user.experience !== 'BEGINNER' &&
    (nextIndex + 1) % policy.scheduledDeloadEvery === 0
  ) {
    deload = 'DELOAD_SCHEDULED';
  }
  if (deload === 'DELOAD_FATIGUE') fatigueWeeksInRow = 0;

  if (resuming) rationale.push({ code: 'RESUME_AFTER_DELOAD' });
  else if (deload)
    rationale.push({ code: deload, detail: { volumeShare: policy.deloadVolumeShare } });
  else if (missedHeavy) rationale.push({ code: 'HOLD_MISSED', detail: { missed } });
  else if (recoveryLimited) rationale.push({ code: 'HOLD_RECOVERY' });

  const sessions = clone(base);
  const draft: PlanWeek = { ...base, sessions };
  const bounds = policy.weeklySetsPerMuscle[user.experience];
  const canAddSet = (session: PlannedSession, ex: Exercise): boolean => {
    if (
      estimateSessionMinutes(session.exercises, policy) + policy.minutesPerSet >
      user.sessionMinutes + policy.sessionOverrunMinutes
    ) {
      return false;
    }
    const totals = weeklySetsByMuscle(draft, catalog);
    // The exercise is in the draft, so each of its muscles has a total.
    return ex.primaryMuscles.every((m) => totals.get(m)! + 1 <= bounds.max);
  };

  for (const session of sessions) {
    const log = logByDay.get(session.dayOfWeek);
    const next = (pe: PlannedExercise): PlannedExercise => {
      const at = { exerciseId: pe.exerciseId, dayOfWeek: session.dayOfWeek };
      const ex = catalog.get(pe.exerciseId);
      const working = (log?.sets ?? []).filter(
        (s): s is LoggedSet & { reps: number } =>
          s.exerciseId === pe.exerciseId && !s.isWarmup && s.reps !== null,
      );
      const loggedLoad = working.reduce<number | null>(
        (max, s) => (s.loadKg !== null && (max === null || s.loadKg > max) ? s.loadKg : max),
        null,
      );
      const eq = ex ? loadEquipment(ex, user.equipment, policy) : null;
      const load = pe.targetLoadKg ?? loggedLoad;

      // 1. Pain: swap to the regression, or cut the load when there is none.
      if (painful.has(pe.exerciseId)) {
        const regression = usable(ex?.regressionId);
        if (regression) {
          rationale.push({
            code: 'PAIN_REGRESSION',
            ...at,
            detail: { toExerciseId: regression.id },
          });
          return {
            ...pe,
            exerciseId: regression.id,
            substitutedFromId: pe.exerciseId,
            targetLoadKg: null,
            loadHintKg: null,
            targetReps: pe.repMin,
          };
        }
        const reduced =
          load !== null
            ? roundToIncrement(load * policy.regressLoadFactor, eq?.incrementKg ?? 0, 'down')
            : null;
        rationale.push({
          code: 'PAIN_LOAD_REDUCED',
          ...at,
          detail: { fromKg: load, toKg: reduced },
        });
        return { ...pe, targetLoadKg: reduced, targetReps: pe.repMin };
      }

      // 2. Deload weeks, resumed weeks and heavy-miss weeks keep the prescription as it is.
      const established = { ...pe, targetLoadKg: load };
      if (resuming || deload || missedHeavy) return resuming ? pe : established;

      if (working.length === 0) {
        rationale.push({ code: 'HOLD_NOT_PERFORMED', ...at });
        return pe;
      }

      // 5. Regress: under half the prescribed reps, or the first set already at RPE 9.5+.
      const totalReps = working.reduce((n, s) => n + s.reps, 0);
      const first = [...working].sort((a, b) => a.setNumber - b.setNumber)[0]!;
      if (totalReps < 0.5 * pe.sets * pe.repMin || (first.rpe ?? 0) >= 9.5) {
        const toKg =
          load !== null
            ? roundToIncrement(load * policy.regressLoadFactor, eq?.incrementKg ?? 0, 'down')
            : null;
        rationale.push({ code: 'REGRESS_LOAD', ...at, detail: { fromKg: load, toKg } });
        return { ...pe, targetLoadKg: toKg, targetReps: pe.repMin };
      }

      if (working.length < pe.sets) {
        rationale.push({
          code: 'HOLD_INCOMPLETE',
          ...at,
          detail: { done: working.length, prescribed: pe.sets },
        });
        return established;
      }

      // 3. Double progression: every set at the top of the range, at or under the target RPE.
      const topped = working.every(
        (s) => s.reps >= pe.repMax && (s.rpe === null || s.rpe <= pe.targetRpe),
      );
      if (!topped) {
        // 4. Hold: same load, one more rep.
        const targetReps = Math.min(pe.repMax, (pe.targetReps ?? pe.repMin) + 1);
        rationale.push({ code: 'HOLD_REPS', ...at, detail: { targetReps } });
        return { ...established, targetReps };
      }
      // 7. Recovery modifiers block increases.
      if (recoveryLimited) return established;

      if (eq && load !== null) {
        const toKg = roundToIncrement(addKg(load, eq.incrementKg), eq.incrementKg, 'down');
        if (eq.maxLoadKg === null || toKg <= eq.maxLoadKg) {
          rationale.push({ code: 'PROGRESS_LOAD', ...at, detail: { fromKg: load, toKg } });
          return { ...pe, targetLoadKg: toKg, targetReps: pe.repMin, loadHintKg: null };
        }
      } else if (eq) {
        // Loadable, but no load logged yet: nothing to add to.
        rationale.push({ code: 'HOLD_REPS', ...at, detail: { targetReps: pe.repMax } });
        return { ...pe, targetReps: pe.repMax };
      }

      // Load cannot go up (max dumbbell, bodyweight): add a set, then move to the progression.
      const baseSets = pe.baseSets ?? pe.sets;
      if (ex && pe.sets < baseSets + policy.maxAddedSets && canAddSet(session, ex)) {
        rationale.push({ code: 'PROGRESS_ADD_SET', ...at, detail: { sets: pe.sets + 1 } });
        return { ...established, sets: pe.sets + 1, baseSets };
      }
      const progression = usable(ex?.progressionId);
      if (progression) {
        rationale.push({
          code: 'PROGRESS_EXERCISE',
          ...at,
          detail: { toExerciseId: progression.id },
        });
        return {
          ...pe,
          exerciseId: progression.id,
          sets: baseSets,
          baseSets,
          targetLoadKg: null,
          loadHintKg: null,
          targetReps: pe.repMin,
        };
      }
      rationale.push({ code: 'HOLD_MAX_REACHED', ...at });
      return established;
    };
    // In place, so set additions count against the session and weekly limits as they happen.
    session.exercises.forEach((pe, i) => (session.exercises[i] = next(pe)));
  }

  if (deload) {
    deloadSets(sessions, policy.deloadVolumeShare);
    for (const e of sessions.flatMap((s) => s.exercises))
      e.targetRpe = Math.max(1, e.targetRpe - policy.deloadRpeDrop);
  }

  if (missedWeeksInRow >= policy.missedWeeksBeforeFewerDays) {
    if (base.sessions.length > 2) {
      recommendations.push({
        kind: 'REDUCE_TRAINING_DAYS',
        detail: { fromDays: base.sessions.length, toDays: base.sessions.length - 1 },
      });
    }
    missedWeeksInRow = 0;
  }

  return {
    week: {
      weekIndex: nextIndex,
      kind: deload ? 'DELOAD' : 'NORMAL',
      templateId: base.templateId,
      sessions,
      rationale,
    },
    recommendations,
    history: {
      fatigueWeeksInRow,
      missedWeeksInRow,
      painReports,
    },
  };
}
