import { describe, expect, it } from 'vitest';
import { detectPersonalRecords, e1rm, sessionStatus } from '../../src/workouts';
import { sets } from './helpers';

describe('e1rm', () => {
  it('uses Epley for 1–10 reps only', () => {
    expect(e1rm(100, 5)).toBe(116.67);
    expect(e1rm(100, 1)).toBe(103.33);
    expect(e1rm(100, 10)).toBe(133.33);
    expect([e1rm(100, 11), e1rm(100, 0), e1rm(100, 2.5), e1rm(0, 5)]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe('sessionStatus (TC-WO-11)', () => {
  it.each([
    [10, 8, 'COMPLETED'],
    [10, 7, 'PARTIAL'],
    [5, 4, 'COMPLETED'],
    [5, 3, 'PARTIAL'],
    [0, 0, 'COMPLETED'],
  ])('%i prescribed, %i logged → %s', (prescribed, logged, status) => {
    expect(sessionStatus(prescribed, logged)).toBe(status);
  });
});

describe('detectPersonalRecords', () => {
  it('finds new bests for e1RM, load, reps and session volume', () => {
    const logged = [
      ...sets('squat', 1, 5, 100, 8, { id: 'a' }),
      { ...sets('squat', 1, 8, 90, 8, { id: 'b' })[0]!, setNumber: 2 },
      ...sets('squat', 1, 12, 20, 5, { isWarmup: true }),
      ...sets('push-up', 2, 20, null),
    ];
    const hits = detectPersonalRecords(logged, [
      { exerciseId: 'squat', kind: 'max_load', value: 100 },
      { exerciseId: 'squat', kind: 'e1rm', value: 110 },
    ]);
    expect(hits).toEqual([
      { exerciseId: 'squat', kind: 'max_reps', value: 8, previous: null, setId: 'b' },
      { exerciseId: 'squat', kind: 'e1rm', value: 116.67, previous: 110, setId: 'a' },
      { exerciseId: 'push-up', kind: 'max_reps', value: 20, previous: null },
      { exerciseId: 'squat', kind: 'max_volume', value: 1220, previous: null },
    ]);
  });

  it('ignores sets without reps and does not repeat an equal best', () => {
    expect(
      detectPersonalRecords([...sets('row', 1, null, 50), ...sets('row', 1, 0, 50)], []),
    ).toEqual([]);
    expect(
      detectPersonalRecords(sets('row', 1, 10, null), [
        { exerciseId: 'row', kind: 'max_reps', value: 10 },
      ]),
    ).toEqual([]);
  });
});
