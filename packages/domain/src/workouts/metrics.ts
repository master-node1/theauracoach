import type { LoggedSet, SessionStatus } from './types';

// Session and strength metrics (workouts LLD §4 "Estimated 1RM", §6 session status, PRs).

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Epley estimated one-rep max; only computed for 1–10 reps. */
export function e1rm(loadKg: number, reps: number): number | null {
  if (!(loadKg > 0) || !Number.isInteger(reps) || reps < 1 || reps > 10) return null;
  return round2(loadKg * (1 + reps / 30));
}

/** COMPLETED when at least 80% of the prescribed working sets were logged, else PARTIAL. */
export function sessionStatus(
  prescribedSets: number,
  loggedWorkingSets: number,
): Extract<SessionStatus, 'COMPLETED' | 'PARTIAL'> {
  if (prescribedSets <= 0) return 'COMPLETED';
  return loggedWorkingSets >= 0.8 * prescribedSets ? 'COMPLETED' : 'PARTIAL';
}

export type PrKind = 'e1rm' | 'max_load' | 'max_reps' | 'max_volume';

export interface PersonalBest {
  exerciseId: string;
  kind: PrKind;
  value: number;
}

export interface PersonalRecordHit extends PersonalBest {
  /** The set that set the record (`LoggedSet.id`), when the caller passed ids. */
  setId?: string;
  previous: number | null;
}

/**
 * New personal records in one session: best e1RM, heaviest load and most reps per set, and most
 * volume (load × reps summed) per exercise. A record must beat the previous best strictly.
 */
export function detectPersonalRecords(
  sets: LoggedSet[],
  previous: PersonalBest[],
): PersonalRecordHit[] {
  const prior = new Map(previous.map((p) => [`${p.exerciseId}:${p.kind}`, p.value]));
  const best = new Map<
    string,
    { value: number; setId?: string; exerciseId: string; kind: PrKind }
  >();
  const offer = (exerciseId: string, kind: PrKind, value: number | null, setId?: string) => {
    if (value === null || !(value > 0)) return;
    const key = `${exerciseId}:${kind}`;
    const cur = best.get(key);
    if (!cur || value > cur.value) best.set(key, { value: round2(value), setId, exerciseId, kind });
  };
  const volume = new Map<string, number>();
  for (const s of sets) {
    if (s.isWarmup || s.reps === null || s.reps <= 0) continue;
    offer(s.exerciseId, 'max_reps', s.reps, s.id);
    if (s.loadKg !== null && s.loadKg > 0) {
      offer(s.exerciseId, 'max_load', s.loadKg, s.id);
      offer(s.exerciseId, 'e1rm', e1rm(s.loadKg, s.reps), s.id);
      volume.set(s.exerciseId, (volume.get(s.exerciseId) ?? 0) + s.loadKg * s.reps);
    }
  }
  for (const [exerciseId, v] of volume) offer(exerciseId, 'max_volume', v);

  const hits: PersonalRecordHit[] = [];
  for (const [key, b] of best) {
    const prev = prior.get(key) ?? null;
    if (prev === null || b.value > prev) {
      hits.push({
        exerciseId: b.exerciseId,
        kind: b.kind,
        value: b.value,
        previous: prev,
        ...(b.setId ? { setId: b.setId } : {}),
      });
    }
  }
  return hits;
}
