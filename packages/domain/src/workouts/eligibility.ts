import type { WorkoutPolicy } from './policy';
import {
  BODYWEIGHT,
  type Exercise,
  type ExperienceLevel,
  type HealthCondition,
  type IntensityCap,
  type Severity,
  type UserEquipment,
} from './types';

const LEVEL: Record<ExperienceLevel, number> = { BEGINNER: 0, INTERMEDIATE: 1, ADVANCED: 2 };
const SEVERITY: Record<Severity, number> = { mild: 0, moderate: 1, severe: 2 };

export function levelRank(level: ExperienceLevel): number {
  return LEVEL[level];
}

/** Tags excluded by the user's active conditions (from their minimum severity up) and intensity cap. */
export function excludedTags(
  conditions: HealthCondition[],
  intensityCap: IntensityCap,
  policy: WorkoutPolicy,
): Set<string> {
  const tags = new Set<string>();
  for (const c of conditions) {
    const rule = policy.contraindicationMap[c.code];
    if (rule && SEVERITY[c.severity] >= SEVERITY[rule.minSeverity]) {
      rule.tags.forEach((t) => tags.add(t));
    }
  }
  if (intensityCap === 'LOW') policy.lowCapExcludedTags.forEach((t) => tags.add(t));
  return tags;
}

export function availableEquipment(equipment: UserEquipment[]): Set<string> {
  return new Set([BODYWEIGHT, ...equipment.map((e) => e.code)]);
}

export function equipmentAvailable(exercise: Exercise, available: Set<string>): boolean {
  return exercise.equipment.every((code) => available.has(code));
}

export type IneligibleReason = 'NOT_PUBLISHED' | 'EQUIPMENT' | 'DIFFICULTY' | 'CONTRAINDICATED';

export interface EligibilityContext {
  available: Set<string>;
  excluded: Set<string>;
  experience: ExperienceLevel;
}

/** Why an exercise cannot be prescribed to this user, or null when it can. */
export function ineligibility(
  exercise: Exercise,
  ctx: EligibilityContext,
): IneligibleReason | null {
  if (exercise.status !== 'PUBLISHED') return 'NOT_PUBLISHED';
  if (!equipmentAvailable(exercise, ctx.available)) return 'EQUIPMENT';
  if (LEVEL[exercise.difficulty] > LEVEL[ctx.experience]) return 'DIFFICULTY';
  if (exercise.contraindications.some((t) => ctx.excluded.has(t))) return 'CONTRAINDICATED';
  return null;
}

/** Loaded hinge compounds (deadlift family), limited for beginners. */
export function isHeavyHinge(exercise: Exercise): boolean {
  return (
    exercise.movementPattern === 'hinge' &&
    exercise.mechanics === 'compound' &&
    !exercise.isBodyweight
  );
}

export function sharesPrimaryMuscle(a: Exercise, b: Exercise): boolean {
  return a.primaryMuscles.some((m) => b.primaryMuscles.includes(m));
}
