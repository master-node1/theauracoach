import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKOUT_POLICY, loadEquipment, roundToIncrement } from '../../src/workouts';
import { ex } from './fixtures';

describe('load maths', () => {
  it('rounds to the increment without float drift', () => {
    expect(roundToIncrement(22.4, 2.5)).toBe(22.5);
    expect(roundToIncrement(0.1 + 0.2, 0.1)).toBe(0.3);
    expect(roundToIncrement(18, 2.5, 'down')).toBe(17.5);
    expect(roundToIncrement(18, 2.5, 'up')).toBe(20);
    expect(roundToIncrement(18.333, 0)).toBe(18.33);
  });

  it('finds the load-carrying equipment and its step', () => {
    expect(
      loadEquipment(
        ex('dumbbell-bench-press'),
        [{ code: 'dumbbell', maxLoadKg: 30, incrementKg: 2.5 }],
        DEFAULT_WORKOUT_POLICY,
      ),
    ).toEqual({ code: 'dumbbell', incrementKg: 2.5, maxLoadKg: 30 });
    expect(loadEquipment(ex('barbell-row'), [], DEFAULT_WORKOUT_POLICY)).toEqual({
      code: 'barbell',
      incrementKg: 2.5,
      maxLoadKg: null,
    });
    expect(
      loadEquipment(ex('band-row'), [{ code: 'resistance_band' }], DEFAULT_WORKOUT_POLICY),
    ).toBeNull();
  });
});
