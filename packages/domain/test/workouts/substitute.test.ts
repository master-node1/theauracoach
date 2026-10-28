import { describe, expect, it } from 'vitest';
import { substitute, type SubstituteInput } from '../../src/workouts';
import { EXERCISES, GYM_EQUIPMENT, ex } from './fixtures';

const user = (
  equipment: SubstituteInput['user']['equipment'],
  o: Partial<SubstituteInput['user']> = {},
) => ({
  experience: 'INTERMEDIATE' as const,
  intensityCap: 'STANDARD' as const,
  equipment,
  conditions: [],
  ...o,
});
const ids = (input: SubstituteInput) => substitute(input).map((s) => s.exercise.id);

describe('substitute (TC-WO-9)', () => {
  it('suggests only dumbbell, bench or bodyweight squats that train the quadriceps', () => {
    const result = substitute({
      exercise: ex('barbell-back-squat'),
      catalog: EXERCISES,
      user: user([{ code: 'dumbbell' }, { code: 'bench' }]),
    });
    expect(result.map((s) => s.exercise.id)).toEqual([
      'goblet-squat',
      'bodyweight-squat',
      'jump-squat',
    ]);
    for (const { exercise } of result) {
      expect(exercise.equipment.every((c) => ['dumbbell', 'bench'].includes(c))).toBe(true);
      expect(exercise.primaryMuscles).toContain('quadriceps');
    }
  });

  it('ranks by muscle overlap, then matching mechanics, and returns at most five', () => {
    const result = substitute({
      exercise: ex('barbell-back-squat'),
      catalog: EXERCISES,
      user: user(GYM_EQUIPMENT),
    });
    expect(result.map((s) => [s.exercise.id, s.score])).toEqual([
      ['goblet-squat', 0.75],
      ['bodyweight-squat', 0.5],
      ['leg-press', 0.5],
      ['jump-squat', 0.4],
      ['leg-extension', 0.25],
    ]);
    expect(
      ids({
        exercise: ex('barbell-back-squat'),
        catalog: EXERCISES,
        user: user(GYM_EQUIPMENT),
        limit: 2,
      }),
    ).toHaveLength(2);
  });

  it('skips equipment that is busy right now', () => {
    const busy = ids({
      exercise: ex('barbell-back-squat'),
      catalog: EXERCISES,
      user: user(GYM_EQUIPMENT),
      reason: { kind: 'EQUIPMENT_BUSY', equipment: ['machine'] },
    });
    expect(busy).not.toContain('leg-press');
    expect(
      ids({
        exercise: ex('barbell-back-squat'),
        catalog: EXERCISES,
        user: user(GYM_EQUIPMENT),
        reason: { kind: 'PAIN' },
      }),
    ).toContain('leg-press');
  });

  it('respects contraindications and stays within one difficulty level', () => {
    const knee = user(GYM_EQUIPMENT, {
      conditions: [{ code: 'injury_knee', severity: 'moderate' }],
    });
    expect(ids({ exercise: ex('goblet-squat'), catalog: EXERCISES, user: knee })).toEqual([
      'bodyweight-squat',
    ]);
    const advanced = {
      ...ex('barbell-back-squat'),
      id: 'pistol',
      slug: 'pistol',
      difficulty: 'ADVANCED' as const,
      equipment: [],
    };
    const advancedUser = user(GYM_EQUIPMENT, { experience: 'ADVANCED' });
    expect(
      ids({
        exercise: ex('bodyweight-squat'),
        catalog: [...EXERCISES, advanced],
        user: advancedUser,
      }),
    ).not.toContain('pistol');
  });

  it('converts load by a known ratio, rounded down to the increment and capped', () => {
    const ratios = {
      'barbell-back-squat>goblet-squat': 0.4,
      'barbell-back-squat>bodyweight-squat': 0.5,
    };
    const base = {
      exercise: ex('barbell-back-squat'),
      catalog: EXERCISES,
      loadKg: 60,
      loadRatios: ratios,
    };
    const result = substitute({ ...base, user: user(GYM_EQUIPMENT) });
    expect(Object.fromEntries(result.map((s) => [s.exercise.id, s.loadKg]))).toMatchObject({
      'goblet-squat': 24,
      'bodyweight-squat': null,
      'leg-press': null,
    });
    const capped = substitute({ ...base, user: user([{ code: 'dumbbell', maxLoadKg: 20 }]) });
    expect(capped.find((s) => s.exercise.id === 'goblet-squat')?.loadKg).toBe(20);
    expect(substitute({ ...base, loadKg: null, user: user(GYM_EQUIPMENT) })[0]!.loadKg).toBeNull();
  });

  it('scores exercises with no listed muscles as zero overlap', () => {
    const bare = {
      ...ex('plank'),
      id: 'bare',
      slug: 'bare',
      primaryMuscles: [],
      secondaryMuscles: [],
    };
    const other = { ...bare, id: 'bare-2', slug: 'bare-2' };
    expect(substitute({ exercise: bare, catalog: [other], user: user([]) })).toEqual([]);
  });
});
