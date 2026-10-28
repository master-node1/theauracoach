import type { WorkoutPolicy } from './policy';
import type { Exercise, UserEquipment } from './types';

// Load maths in integer hundredths of a kilogram, so 0.1 + 0.2 style float drift never reaches a
// prescription. Inputs are kg with at most two decimals (the Decimal(6,2) columns).

const toCenti = (kg: number): number => Math.round(kg * 100);

export type RoundMode = 'down' | 'nearest' | 'up';

/** Rounds `kg` to a multiple of `incrementKg`. */
export function roundToIncrement(
  kg: number,
  incrementKg: number,
  mode: RoundMode = 'nearest',
): number {
  const value = toCenti(kg);
  const step = toCenti(incrementKg);
  if (step <= 0) return value / 100;
  const steps = value / step;
  const n =
    mode === 'down' ? Math.floor(steps) : mode === 'up' ? Math.ceil(steps) : Math.round(steps);
  return (n * step) / 100;
}

export function addKg(a: number, b: number): number {
  return (toCenti(a) + toCenti(b)) / 100;
}

export interface LoadEquipment {
  code: string;
  incrementKg: number;
  maxLoadKg: number | null;
}

/** The piece of equipment that carries the load and its step, or null when load cannot be added. */
export function loadEquipment(
  exercise: Exercise,
  userEquipment: UserEquipment[],
  policy: WorkoutPolicy,
): LoadEquipment | null {
  for (const code of exercise.equipment) {
    const owned = userEquipment.find((e) => e.code === code);
    const incrementKg = owned?.incrementKg ?? policy.loadIncrementsKg[code];
    if (incrementKg && incrementKg > 0) {
      return { code, incrementKg, maxLoadKg: owned?.maxLoadKg ?? null };
    }
  }
  return null;
}
