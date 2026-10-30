import { DEFAULT_WORKOUT_POLICY, type WorkoutPolicy } from '@aura/domain/workouts';
import type { PrismaClient } from '../generated/prisma';

/**
 * The engine policy from `WorkoutPolicy` rows (one row per policy field, seeded by migration from
 * DEFAULT_WORKOUT_POLICY). A field without a row keeps its default, so a new policy field works
 * before its row exists; rows for unknown keys are ignored.
 */
export async function loadWorkoutPolicy(
  prisma: Pick<PrismaClient, 'workoutPolicy'>,
): Promise<WorkoutPolicy> {
  const rows = await prisma.workoutPolicy.findMany({ select: { key: true, value: true } });
  const policy: Record<string, unknown> = { ...DEFAULT_WORKOUT_POLICY };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_WORKOUT_POLICY, row.key)) {
      policy[row.key] = row.value;
    }
  }
  return policy as unknown as WorkoutPolicy;
}
