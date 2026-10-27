import {
  availableEquipment,
  excludedTags,
  ineligibility,
  isHeavyHinge,
  levelRank,
  sharesPrimaryMuscle,
  type EligibilityContext,
} from './eligibility';
import { loadEquipment, roundToIncrement } from './load';
import { DEFAULT_WORKOUT_POLICY, type WorkoutPolicy } from './policy';
import {
  EXPERIENCE_LEVELS,
  type Exercise,
  type GoalType,
  type PlannedExercise,
  type PlannedSession,
  type PlanWeek,
  type RationaleEntry,
  type TemplateSlot,
  type UserTrainingInput,
  type WorkoutTemplate,
} from './types';
import { validatePlan, weeklySetsByMuscle, type ValidationIssue } from './validate-plan';

// Initial plan generation (workouts LLD §3). Deterministic: the same input and catalog always
// produce the same week, so the onboarding saga can retry safely.

export interface WorkoutCatalog {
  exercises: Exercise[];
  templates: WorkoutTemplate[];
}

/** Log message workout-service writes when the selected template's plan was rejected. */
export const PLAN_VALIDATION_FALLBACK_LOG = 'plan_validation_fallback';

export type GeneratePlanError =
  'INVALID_INPUT' | 'NO_TEMPLATE' | 'NO_ELIGIBLE_EXERCISES' | 'PLAN_INVALID';

export type GeneratePlanResult =
  | {
      ok: true;
      week: PlanWeek;
      templateId: string;
      /** True when the safe default template replaced a plan that failed validation. */
      fallback: boolean;
      /** Why the first plan was rejected (empty unless `fallback`). */
      rejectedIssues: ValidationIssue[];
    }
  | { ok: false; error: GeneratePlanError; issues?: ValidationIssue[] };

/** Rep ranges by goal (LLD §3.4); fat loss and general fitness keep the template's range. */
function repRange(goal: GoalType, exercise: Exercise, slot: TemplateSlot): [number, number] {
  switch (goal) {
    case 'STRENGTH':
      return exercise.mechanics === 'compound' ? [3, 6] : [8, 12];
    case 'MUSCLE_GAIN':
      return [8, 12];
    case 'ENDURANCE':
      return [12, 20];
    default: {
      const min = Math.max(1, Math.round(slot.repMin));
      return [min, Math.max(min, Math.round(slot.repMax))];
    }
  }
}

const DUMBBELL_HINT_RATIO: Partial<Record<Exercise['movementPattern'], number>> = {
  squat: 0.1,
  lunge: 0.08,
  hinge: 0.1,
  push_h: 0.08,
  push_v: 0.06,
  pull_h: 0.1,
  pull_v: 0.08,
};

function validInput(input: UserTrainingInput, policy: WorkoutPolicy): boolean {
  const days = input.trainingDays;
  return (
    days.length >= 2 &&
    days.length <= 6 &&
    new Set(days).size === days.length &&
    days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    input.sessionMinutes >= policy.warmupMinutes + policy.minutesPerSet
  );
}

interface Selection {
  template: WorkoutTemplate;
  rationale: RationaleEntry;
}

/** Template selection with fallbacks: same goal any location, then general fitness, then easier levels. */
export function selectTemplate(
  templates: WorkoutTemplate[],
  input: Pick<UserTrainingInput, 'goal' | 'experience' | 'location' | 'trainingDays'>,
): Selection | null {
  const days = input.trainingDays.length;
  const published = templates
    .filter((t) => t.status === 'PUBLISHED' && t.daysPerWeek === days)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const levels = EXPERIENCE_LEVELS.filter(
    (l) => levelRank(l) <= levelRank(input.experience),
  ).reverse();
  for (const level of levels) {
    const atLevel = published.filter((t) => t.experience === level);
    const pick = (pred: (t: WorkoutTemplate) => boolean) => atLevel.find(pred);
    const exact = pick((t) => t.goal === input.goal && t.location === input.location);
    if (exact)
      return {
        template: exact,
        rationale: { code: 'TEMPLATE_SELECTED', detail: { templateId: exact.id } },
      };
    const anyLocation = pick((t) => t.goal === input.goal);
    if (anyLocation) {
      return {
        template: anyLocation,
        rationale: { code: 'TEMPLATE_FALLBACK_LOCATION', detail: { templateId: anyLocation.id } },
      };
    }
    const general =
      pick((t) => t.goal === 'GENERAL_FITNESS' && t.location === input.location) ??
      pick((t) => t.goal === 'GENERAL_FITNESS');
    if (general) {
      return {
        template: general,
        rationale: { code: 'TEMPLATE_FALLBACK_GENERAL', detail: { templateId: general.id } },
      };
    }
  }
  return null;
}

interface BuildContext {
  input: UserTrainingInput;
  catalog: ReadonlyMap<string, Exercise>;
  policy: WorkoutPolicy;
  eligibility: EligibilityContext;
}

/** Candidate ranking (LLD §3.2): same pattern, same primary muscle, compound, completion rate. */
function rankCandidates(
  slotExercise: Exercise,
  candidates: Exercise[],
  input: UserTrainingInput,
): Exercise[] {
  const score = (e: Exercise) => [
    e.movementPattern === slotExercise.movementPattern ? 1 : 0,
    sharesPrimaryMuscle(e, slotExercise) ? 1 : 0,
    e.mechanics === 'compound' ? 1 : 0,
    input.completionRates?.[e.id] ?? 0,
  ];
  return [...candidates].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      const diff = (sb[i] as number) - (sa[i] as number);
      if (diff !== 0) return diff;
    }
    return a.slug.localeCompare(b.slug);
  });
}

function prescribe(
  slot: TemplateSlot,
  exercise: Exercise,
  order: number,
  ctx: BuildContext,
  rationale: RationaleEntry[],
): PlannedExercise {
  const { input, policy } = ctx;
  let [repMin, repMax] = repRange(input.goal, exercise, slot);
  const band: [number, number] = input.experience === 'BEGINNER' ? [6, 7] : [7, 8];
  let targetRpe = Math.min(band[1], Math.max(band[0], slot.targetRpe));
  if (input.intensityCap === 'LOW') {
    targetRpe = Math.min(targetRpe, policy.lowCapMaxRpe);
    if (repMin < policy.lowCapMinReps) {
      repMin = policy.lowCapMinReps;
      repMax = Math.max(repMax, repMin + 2);
    }
  }
  const sets = Math.max(1, Math.round(slot.sets));
  const planned: PlannedExercise = {
    order,
    exerciseId: exercise.id,
    sets,
    baseSets: sets,
    repMin,
    repMax,
    targetReps: repMin,
    targetLoadKg: null,
    targetRpe,
    restSec: Math.max(0, Math.round(slot.restSec)),
  };
  const hint = dumbbellHint(exercise, ctx);
  if (hint !== null) {
    planned.loadHintKg = hint;
    if (!rationale.some((r) => r.code === 'START_LIGHT')) rationale.push({ code: 'START_LIGHT' });
  }
  return planned;
}

/** "Start light" suggestion from a bodyweight ratio; barbell and machine loads come from the first session. */
function dumbbellHint(exercise: Exercise, ctx: BuildContext): number | null {
  const bw = ctx.input.bodyweightKg;
  const ratio = DUMBBELL_HINT_RATIO[exercise.movementPattern];
  if (!bw || !ratio || !exercise.equipment.includes('dumbbell')) return null;
  const eq = loadEquipment(exercise, ctx.input.equipment, ctx.policy);
  if (!eq || eq.code !== 'dumbbell') return null;
  const scale = ctx.input.experience === 'BEGINNER' ? 0.75 : 1;
  let kg = Math.max(eq.incrementKg, roundToIncrement(bw * ratio * scale, eq.incrementKg, 'down'));
  if (eq.maxLoadKg !== null) kg = Math.min(kg, eq.maxLoadKg);
  return kg;
}

function resolveSessions(
  template: WorkoutTemplate,
  ctx: BuildContext,
  rationale: RationaleEntry[],
): PlannedSession[] {
  const { input, catalog, policy, eligibility } = ctx;
  const days = [...template.days].sort((a, b) => a.dayIndex - b.dayIndex);
  const pool = [...catalog.values()].filter((e) => ineligibility(e, eligibility) === null);
  const limitHinge = input.experience === 'BEGINNER';
  let hingeSessions = 0;
  const sessions: PlannedSession[] = [];

  for (let i = 0; i < input.trainingDays.length && days.length > 0; i++) {
    const day = days[i % days.length]!;
    const slots = template.slots
      .filter((s) => s.dayIndex === day.dayIndex)
      .sort((a, b) => a.order - b.order);
    const used = new Set<string>();
    let sessionHasHinge = false;
    const exercises: PlannedExercise[] = [];

    for (const slot of slots) {
      const slotExercise = catalog.get(slot.exerciseId);
      if (!slotExercise) {
        rationale.push({
          code: 'SLOT_DROPPED',
          exerciseId: slot.exerciseId,
          detail: { reason: 'UNKNOWN_EXERCISE' },
        });
        continue;
      }
      const hingeBlocked =
        limitHinge && !sessionHasHinge && hingeSessions >= policy.beginnerHeavyHingeSessionsPerWeek;
      const usable = (e: Exercise) => !used.has(e.id) && !(hingeBlocked && isHeavyHinge(e));

      let chosen: Exercise | undefined;
      if (usable(slotExercise) && ineligibility(slotExercise, eligibility) === null) {
        chosen = slotExercise;
      } else {
        const candidates = pool.filter(
          (e) =>
            usable(e) &&
            (e.movementPattern === slotExercise.movementPattern ||
              sharesPrimaryMuscle(e, slotExercise)),
        );
        chosen = rankCandidates(slotExercise, candidates, input)[0];
        if (hingeBlocked && isHeavyHinge(slotExercise)) {
          rationale.push({ code: 'HINGE_FREQUENCY_LIMITED', exerciseId: slotExercise.id });
        }
        if (chosen) {
          rationale.push({
            code: 'EXERCISE_RESOLVED',
            exerciseId: chosen.id,
            detail: {
              fromExerciseId: slotExercise.id,
              reason:
                ineligibility(slotExercise, eligibility) ??
                (used.has(slotExercise.id) ? 'DUPLICATE' : 'HINGE_LIMIT'),
            },
          });
        } else {
          rationale.push({
            code: 'SLOT_DROPPED',
            exerciseId: slotExercise.id,
            detail: { reason: 'NO_CANDIDATE' },
          });
          continue;
        }
      }
      used.add(chosen.id);
      if (isHeavyHinge(chosen)) sessionHasHinge = true;
      exercises.push(prescribe(slot, chosen, exercises.length + 1, ctx, rationale));
    }
    if (sessionHasHinge) hingeSessions += 1;
    sessions.push({ dayOfWeek: -1, name: day.name, focus: day.focus, exercises });
  }
  return sessions;
}

/** Removes one set from the least important exercise among `picks`; drops it at one set. */
function trimOneSet(
  session: PlannedSession,
  picks: PlannedExercise[],
  catalog: ReadonlyMap<string, Exercise>,
): void {
  const isolation = (pe: PlannedExercise) =>
    catalog.get(pe.exerciseId)?.mechanics === 'isolation' ? 1 : 0;
  const victim = [...picks].sort(
    (a, b) => b.sets - a.sets || isolation(b) - isolation(a) || b.order - a.order,
  )[0]!;
  if (victim.sets > 1) {
    victim.sets -= 1;
    victim.baseSets = victim.sets;
  } else {
    session.exercises = session.exercises.filter((e) => e !== victim);
    session.exercises.forEach((e, i) => (e.order = i + 1));
  }
}

function fitVolume(
  sessions: PlannedSession[],
  ctx: BuildContext,
  rationale: RationaleEntry[],
): void {
  const { input, policy, catalog } = ctx;
  const budget = Math.max(
    1,
    Math.floor((input.sessionMinutes - policy.warmupMinutes) / policy.minutesPerSet),
  );
  sessions.forEach((session, s) => {
    const before = session.exercises.reduce((n, e) => n + e.sets, 0);
    let total = before;
    while (total > budget) {
      trimOneSet(session, session.exercises, catalog);
      total -= 1;
    }
    if (before > budget)
      rationale.push({ code: 'VOLUME_FITTED_TO_TIME', detail: { session: s, budgetSets: budget } });
  });

  const bounds = policy.weeklySetsPerMuscle[input.experience];
  const cap =
    input.goal === 'FAT_LOSS' || input.goal === 'GENERAL_FITNESS' ? bounds.min : bounds.max;
  const week: PlanWeek = {
    weekIndex: 0,
    kind: 'NORMAL',
    templateId: null,
    sessions,
    rationale: [],
  };
  for (;;) {
    const over = [...weeklySetsByMuscle(week, catalog)].find(([, n]) => n > cap);
    if (!over) break;
    const [muscle] = over;
    // Trim the session carrying the most sets for this muscle, latest first on ties.
    let target: PlannedSession | undefined;
    let most = 0;
    for (const session of sessions) {
      const n = session.exercises
        .filter((e) => catalog.get(e.exerciseId)?.primaryMuscles.includes(muscle))
        .reduce((sum, e) => sum + e.sets, 0);
      if (n >= most && n > 0) {
        most = n;
        target = session;
      }
    }
    const t = target!;
    trimOneSet(
      t,
      t.exercises.filter((e) => catalog.get(e.exerciseId)?.primaryMuscles.includes(muscle)),
      catalog,
    );
    if (!rationale.some((r) => r.code === 'VOLUME_CAPPED' && r.detail?.muscle === muscle)) {
      rationale.push({ code: 'VOLUME_CAPPED', detail: { muscle, weeklySets: cap } });
    }
  }
}

function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  yield [...a];
  // Heap's algorithm would reorder the first yield; plain lexicographic order keeps the template order on ties.
  for (;;) {
    let i = n - 2;
    while (i >= 0 && a[i]! >= a[i + 1]!) i--;
    if (i < 0) return;
    let j = n - 1;
    while (a[j]! <= a[i]!) j--;
    [a[i], a[j]] = [a[j]!, a[i]!];
    a.splice(i + 1, n - i - 1, ...a.slice(i + 1).reverse());
    yield [...a];
  }
}

/** Places sessions on training days, minimising shared primary muscles on consecutive days. */
function schedule(
  sessions: PlannedSession[],
  ctx: BuildContext,
  rationale: RationaleEntry[],
): PlannedSession[] {
  const days = [...ctx.input.trainingDays].sort((a, b) => a - b);
  const muscles = sessions.map(
    (s) => new Set(s.exercises.flatMap((e) => ctx.catalog.get(e.exerciseId)?.primaryMuscles ?? [])),
  );
  const overlap = muscles.map((a) => muscles.map((b) => [...a].filter((m) => b.has(m)).length));
  const adjacent: [number, number][] = [];
  days.forEach((d, i) =>
    days.forEach((e, j) => {
      if (i < j && (e - d === 1 || (d === 0 && e === 6))) adjacent.push([i, j]);
    }),
  );
  let best: number[] = [];
  let bestCost = Infinity;
  for (const perm of permutations(sessions.length)) {
    const cost = adjacent.reduce((c, [i, j]) => c + overlap[perm[i]!]![perm[j]!]!, 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = perm;
    }
    if (cost === 0) break;
  }
  if (bestCost > 0) rationale.push({ code: 'SCHEDULE_BACK_TO_BACK' });
  return best.map((s, i) => ({ ...sessions[s]!, dayOfWeek: days[i]! }));
}

function build(
  template: WorkoutTemplate,
  ctx: BuildContext,
  rationale: RationaleEntry[],
): PlanWeek {
  const sessions = resolveSessions(template, ctx, rationale);
  fitVolume(sessions, ctx, rationale);
  if (ctx.input.intensityCap === 'LOW') rationale.push({ code: 'INTENSITY_CAP_LOW' });
  const scheduled = schedule(sessions, ctx, rationale).filter((s) => s.exercises.length > 0);
  // Repeated template days resolve the same way; explain each decision once.
  const seen = new Set<string>();
  const unique = rationale.filter((r) => {
    const key = JSON.stringify(r);
    return seen.has(key) ? false : (seen.add(key), true);
  });
  return {
    weekIndex: 0,
    kind: 'NORMAL',
    templateId: template.id,
    sessions: scheduled,
    rationale: unique,
  };
}

export function generatePlan(
  input: UserTrainingInput,
  catalog: WorkoutCatalog,
  policy: WorkoutPolicy = DEFAULT_WORKOUT_POLICY,
): GeneratePlanResult {
  if (!validInput(input, policy)) return { ok: false, error: 'INVALID_INPUT' };
  const exercises = new Map(catalog.exercises.map((e) => [e.id, e]));
  const ctx: BuildContext = {
    input,
    catalog: exercises,
    policy,
    eligibility: {
      available: availableEquipment(input.equipment),
      excluded: excludedTags(input.conditions, input.intensityCap, policy),
      experience: input.experience,
    },
  };
  const safeDefault = catalog.templates.find(
    (t) => t.slug === policy.safeDefaultTemplateSlug && t.status === 'PUBLISHED',
  );

  const selection = selectTemplate(catalog.templates, input);
  let rejectedIssues: ValidationIssue[] = [];
  if (selection) {
    const week = build(selection.template, ctx, [selection.rationale]);
    const result = validatePlan(week, input, exercises, policy);
    if (result.valid && week.sessions.length > 0) {
      return { ok: true, week, templateId: selection.template.id, fallback: false, rejectedIssues };
    }
    rejectedIssues = result.issues;
  }
  if (!safeDefault)
    return { ok: false, error: selection ? 'PLAN_INVALID' : 'NO_TEMPLATE', issues: rejectedIssues };

  const fallbackRationale: RationaleEntry[] = selection
    ? [{ code: 'PLAN_VALIDATION_FALLBACK', detail: { rejectedTemplateId: selection.template.id } }]
    : [{ code: 'TEMPLATE_FALLBACK_GENERAL', detail: { templateId: safeDefault.id } }];
  const week = build(safeDefault, ctx, fallbackRationale);
  if (week.sessions.length === 0) return { ok: false, error: 'NO_ELIGIBLE_EXERCISES' };
  const result = validatePlan(week, input, exercises, policy);
  if (!result.valid) return { ok: false, error: 'PLAN_INVALID', issues: result.issues };
  return {
    ok: true,
    week,
    templateId: safeDefault.id,
    fallback: selection !== null,
    rejectedIssues,
  };
}
