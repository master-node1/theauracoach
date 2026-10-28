import { availableEquipment, excludedTags, ineligibility, levelRank } from './eligibility';
import { loadEquipment, roundToIncrement } from './load';
import { DEFAULT_WORKOUT_POLICY, type WorkoutPolicy } from './policy';
import type { Exercise, UserTrainingInput } from './types';

// Exercise substitution (workouts LLD §5): same movement pattern, at least one shared primary
// muscle, only equipment the user can use right now, ranked by muscle overlap.

export type SubstitutionReason =
  { kind: 'EQUIPMENT_BUSY'; equipment: string[] } | { kind: 'PAIN' } | { kind: 'PREFERENCE' };

export interface SubstituteInput {
  exercise: Exercise;
  catalog: Iterable<Exercise>;
  user: Pick<UserTrainingInput, 'experience' | 'intensityCap' | 'equipment' | 'conditions'>;
  reason?: SubstitutionReason;
  /** Current prescribed load, converted for each suggestion when a ratio is known. */
  loadKg?: number | null;
  /** Load ratios keyed `${fromId}>${toId}`, e.g. barbell squat → goblet squat 0.4. */
  loadRatios?: Record<string, number>;
  limit?: number;
}

export interface Substitution {
  exercise: Exercise;
  /** Jaccard similarity of all worked muscles, 0–1. */
  score: number;
  loadKg: number | null;
}

const LEVELS_APART = 1;

function jaccard(a: Exercise, b: Exercise): number {
  const x = new Set([...a.primaryMuscles, ...a.secondaryMuscles]);
  const y = new Set([...b.primaryMuscles, ...b.secondaryMuscles]);
  const both = [...x].filter((m) => y.has(m)).length;
  const either = new Set([...x, ...y]).size;
  return either === 0 ? 0 : both / either;
}

export function substitute(
  input: SubstituteInput,
  policy: WorkoutPolicy = DEFAULT_WORKOUT_POLICY,
): Substitution[] {
  const { exercise: from, user, reason } = input;
  const available = availableEquipment(user.equipment);
  if (reason?.kind === 'EQUIPMENT_BUSY') reason.equipment.forEach((code) => available.delete(code));
  const ctx = {
    available,
    excluded: excludedTags(user.conditions, user.intensityCap, policy),
    experience: user.experience,
  };

  const candidates = [...input.catalog].filter(
    (e) =>
      e.id !== from.id &&
      e.movementPattern === from.movementPattern &&
      e.primaryMuscles.some((m) => from.primaryMuscles.includes(m)) &&
      Math.abs(levelRank(e.difficulty) - levelRank(from.difficulty)) <= LEVELS_APART &&
      ineligibility(e, ctx) === null,
  );

  return candidates
    .map((e) => ({ e, score: jaccard(from, e), mechanics: e.mechanics === from.mechanics ? 1 : 0 }))
    .sort(
      (a, b) => b.score - a.score || b.mechanics - a.mechanics || a.e.slug.localeCompare(b.e.slug),
    )
    .slice(0, input.limit ?? 5)
    .map(({ e, score }) => {
      const ratio = input.loadRatios?.[`${from.id}>${e.id}`];
      let loadKg: number | null = null;
      if (ratio !== undefined && input.loadKg != null) {
        const eq = loadEquipment(e, user.equipment, policy);
        loadKg = eq ? roundToIncrement(input.loadKg * ratio, eq.incrementKg, 'down') : null;
        if (loadKg !== null && eq?.maxLoadKg != null) loadKg = Math.min(loadKg, eq.maxLoadKg);
      }
      return { exercise: e, score: Math.round(score * 1000) / 1000, loadKg };
    });
}
