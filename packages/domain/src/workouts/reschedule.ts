import type { Exercise, PlannedSession, PlanWeek, RationaleEntry } from './types';

// Missed sessions inside a week (workouts LLD §4 rule 6): never stacked. Only the most important
// missed session moves, to the first free day the caller offers; the rest are dropped.

export interface RescheduleInput {
  week: PlanWeek;
  /** Days whose session was missed. */
  missedDays: number[];
  /** Remaining days this week with no session, in calendar order. */
  freeDays: number[];
  catalog: ReadonlyMap<string, Exercise>;
}

export interface RescheduleResult {
  moved: { fromDay: number; toDay: number } | null;
  rationale: RationaleEntry[];
}

/** Compound sets first, then total sets: the session that does the most for the plan. */
function priority(
  session: PlannedSession,
  catalog: ReadonlyMap<string, Exercise>,
): [number, number] {
  let compound = 0;
  let total = 0;
  for (const e of session.exercises) {
    total += e.sets;
    if (catalog.get(e.exerciseId)?.mechanics === 'compound') compound += e.sets;
  }
  return [compound, total];
}

export function rescheduleMissed(input: RescheduleInput): RescheduleResult {
  const taken = new Set(input.week.sessions.map((s) => s.dayOfWeek));
  const toDay = input.freeDays.find((d) => !taken.has(d));
  const missed = input.week.sessions
    .filter((s) => input.missedDays.includes(s.dayOfWeek))
    .map((s) => ({ s, p: priority(s, input.catalog) }))
    .sort((a, b) => b.p[0] - a.p[0] || b.p[1] - a.p[1] || a.s.dayOfWeek - b.s.dayOfWeek);
  const top = missed[0];
  if (toDay === undefined || !top) return { moved: null, rationale: [] };
  const moved = { fromDay: top.s.dayOfWeek, toDay };
  return { moved, rationale: [{ code: 'MISSED_RESCHEDULED', dayOfWeek: toDay, detail: moved }] };
}
