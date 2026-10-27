import { describe, expect, it } from 'vitest';
import { rescheduleMissed } from '../../src/workouts';
import { EXERCISE_MAP } from './fixtures';
import { pe, week } from './helpers';

describe('rescheduleMissed', () => {
  // Monday push, Wednesday legs (more compound sets), Friday pull.
  const w = week([
    [0, [pe('push-up'), pe('cable-fly', { sets: 4 })]],
    [2, [pe('goblet-squat', { sets: 4 }), pe('dumbbell-rdl')]],
    [4, [pe('dumbbell-row')]],
  ]);

  it('moves only the highest-priority missed session to the next free day, never stacking', () => {
    const result = rescheduleMissed({
      week: w,
      missedDays: [0, 2],
      freeDays: [4, 5, 6],
      catalog: EXERCISE_MAP,
    });
    expect(result).toEqual({
      moved: { fromDay: 2, toDay: 5 },
      rationale: [{ code: 'MISSED_RESCHEDULED', dayOfWeek: 5, detail: { fromDay: 2, toDay: 5 } }],
    });
  });

  it('breaks ties on total sets, then the earlier day', () => {
    const tie = week([
      [0, [pe('plank', { sets: 2 })]],
      [1, [pe('plank', { sets: 3 })]],
      [3, [pe('ghost')]],
      [4, [pe('ghost')]],
    ]);
    expect(
      rescheduleMissed({ week: tie, missedDays: [0, 1], freeDays: [2], catalog: EXERCISE_MAP })
        .moved,
    ).toEqual({ fromDay: 1, toDay: 2 });
    expect(
      rescheduleMissed({ week: tie, missedDays: [3, 4], freeDays: [5], catalog: EXERCISE_MAP })
        .moved,
    ).toEqual({ fromDay: 3, toDay: 5 });
  });

  it('moves nothing without a free day or a missed session', () => {
    expect(
      rescheduleMissed({ week: w, missedDays: [0], freeDays: [], catalog: EXERCISE_MAP }),
    ).toEqual({ moved: null, rationale: [] });
    expect(
      rescheduleMissed({ week: w, missedDays: [], freeDays: [5], catalog: EXERCISE_MAP }),
    ).toEqual({ moved: null, rationale: [] });
  });
});
