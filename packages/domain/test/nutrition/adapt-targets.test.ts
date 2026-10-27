import { describe, expect, it } from 'vitest';
import {
  adaptTargets,
  addDays,
  weightTrend,
  type AdaptTargetsInput,
  type WeighIn,
} from '../../src/nutrition';

const ASOF = '2026-12-31';

/** Daily weigh-ins ending on ASOF, changing `ratePct` %/week, with a small alternating wobble. */
function series(
  days: number,
  ratePct: number,
  { every = 1, start = 80, wobble = 0.1 } = {},
): WeighIn[] {
  const out: WeighIn[] = [];
  for (let i = 0; i < days; i += every) {
    const w = start * Math.pow(1 + ratePct / 100, i / 7) + (i % 2 === 0 ? wobble : -wobble);
    out.push({ date: addDays(ASOF, i - days + 1), weightKg: w.toFixed(2) });
  }
  return out;
}

const base = (over: Partial<AdaptTargetsInput>): AdaptTargetsInput => ({
  asOf: ASOF,
  weighIns: series(28, 0),
  adherence: 0.9,
  goal: 'FAT_LOSS',
  goalRatePctPerWeek: -0.5,
  currentEnergyKcal: 1900,
  floorKcal: 1500,
  ...over,
});

describe('adaptTargets', () => {
  it('needs ≥ 14 days and ≥ 8 weigh-ins', () => {
    expect(adaptTargets(base({ weighIns: series(10, -0.5) })).reasons).toEqual([
      'INSUFFICIENT_DATA',
    ]);
    expect(adaptTargets(base({ weighIns: series(28, -0.5, { every: 4 }) })).reasons).toEqual([
      'INSUFFICIENT_DATA',
    ]);
    expect(adaptTargets(base({ weighIns: [] })).kind).toBe('NO_CHANGE');
  });

  it('makes no change when logging adherence is below 70%', () => {
    const r = adaptTargets(base({ adherence: 0.6 }));
    expect(r).toMatchObject({ kind: 'NO_CHANGE', reasons: ['LOW_ADHERENCE'] });
  });

  it('proposes −100 kcal or +2,000 steps on a 3-week plateau with ≥ 80% adherence (TC-NU-13)', () => {
    const r = adaptTargets(base({ adherence: 0.85 }));
    expect(r.kind).toBe('PLATEAU');
    if (r.kind !== 'PLATEAU') return;
    expect(r.options).toEqual([
      { kind: 'REDUCE_ENERGY', deltaKcal: -100, newEnergyKcal: 1800 },
      { kind: 'INCREASE_STEPS', extraStepsPerDay: 2000 },
    ]);
    expect(r.trend.weeklyRatesPct).toHaveLength(3);
  });

  it('does not call a plateau below 80% adherence (TC-NU-13)', () => {
    const r = adaptTargets(base({ adherence: 0.79 }));
    expect(r.kind).not.toBe('PLATEAU');
    // Still ≥ 70%, so the ordinary off-goal rule applies: 0.5%/week too slow → −100 kcal.
    expect(r).toMatchObject({
      kind: 'ADJUST_ENERGY',
      deltaKcal: -100,
      reasons: ['TREND_ABOVE_GOAL_RATE'],
    });
  });

  it('offers only the steps option when the plateau is already at the floor', () => {
    const r = adaptTargets(base({ currentEnergyKcal: 1500 }));
    expect(r).toMatchObject({
      kind: 'PLATEAU',
      options: [{ kind: 'INCREASE_STEPS', extraStepsPerDay: 2000 }],
    });
    expect(r.reasons).toContain('FLOOR_REACHED');
  });

  it('never goes below the floor', () => {
    const at = adaptTargets(base({ adherence: 0.75, currentEnergyKcal: 1500 }));
    expect(at).toMatchObject({
      kind: 'NO_CHANGE',
      reasons: ['TREND_ABOVE_GOAL_RATE', 'FLOOR_REACHED'],
    });
    const near = adaptTargets(base({ adherence: 0.75, currentEnergyKcal: 1550 }));
    expect(near).toMatchObject({ kind: 'ADJUST_ENERGY', newEnergyKcal: 1500, deltaKcal: -50 });
    expect(near.reasons).toContain('FLOOR_APPLIED');
  });

  it('adds 150 kcal when losing far faster than the goal for 2 weeks', () => {
    const r = adaptTargets(base({ weighIns: series(42, -1.5) }));
    expect(r).toMatchObject({
      kind: 'ADJUST_ENERGY',
      deltaKcal: 150,
      newEnergyKcal: 2050,
      reasons: ['TREND_BELOW_GOAL_RATE'],
    });
  });

  it('leaves an on-track user alone', () => {
    const r = adaptTargets(base({ weighIns: series(42, -0.5) }));
    expect(r).toMatchObject({ kind: 'NO_CHANGE', reasons: ['ON_TRACK'] });
  });

  it('trims a muscle-gain surplus when gaining too fast', () => {
    const r = adaptTargets(
      base({
        goal: 'MUSCLE_GAIN',
        goalRatePctPerWeek: 0.25,
        currentEnergyKcal: 2800,
        weighIns: series(42, 1),
      }),
    );
    expect(r).toMatchObject({
      kind: 'ADJUST_ENERGY',
      deltaKcal: -150,
      reasons: ['TREND_ABOVE_GOAL_RATE'],
    });
  });

  it('smooths with α = 0.1 and carries the trend over missing days', () => {
    const t = weightTrend(
      [
        { date: '2026-12-01', weightKg: 80 },
        { date: '2026-12-03', weightKg: 90 },
      ],
      '2026-12-05',
    );
    expect(t.get('2026-12-02')!.toNumber()).toBe(80);
    expect(t.get('2026-12-03')!.toNumber()).toBe(81);
    expect(t.get('2026-12-05')!.toNumber()).toBe(81);
  });
});
