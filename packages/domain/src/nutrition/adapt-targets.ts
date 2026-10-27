import type Decimal from 'decimal.js';
import { addDays } from './assessment';
import { dec, Dec, round, type Numeric } from './decimal';
import { ensure } from './errors';
import type { RationaleCode } from './rationale';
import type { Goal } from './types';

/** Nutrition LLD §2 "Adaptation" (weekly job). Output is a proposal; the user accepts it. */

export const TREND_ALPHA = 0.1;
export const MIN_SPAN_DAYS = 14;
export const MIN_WEIGH_INS = 8;
export const MIN_ADHERENCE = 0.7;
export const PLATEAU_MIN_ADHERENCE = 0.8;
export const RATE_GAP_PCT = 0.25;
export const LARGE_RATE_GAP_PCT = 0.5;
export const SMALL_STEP_KCAL = 100;
export const LARGE_STEP_KCAL = 150;
export const PLATEAU_BAND_PCT = 0.1;
export const PLATEAU_WEEKS = 3;
export const PLATEAU_ENERGY_STEP_KCAL = 100;
export const PLATEAU_EXTRA_STEPS = 2000;

export interface WeighIn {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  weightKg: Numeric;
}

export interface AdaptTargetsInput {
  /** Last day of the evaluation window (ISO date). */
  asOf: string;
  weighIns: readonly WeighIn[];
  /** Share of days in the window with food logged, 0–1. */
  adherence: number;
  goal: Goal;
  /** Goal rate in % bodyweight per week, signed: −0.5 to lose, +0.25 to gain, 0 to hold. */
  goalRatePctPerWeek: number;
  currentEnergyKcal: number;
  /** The safety floor from `calculateTargets` (`basis.floorKcal`). */
  floorKcal: number;
}

export interface Trend {
  /** Smoothed weight on `asOf`. */
  currentKg: Decimal;
  /** Observed % change per week, most recent week first. */
  weeklyRatesPct: number[];
}

export type PlateauOption =
  | { kind: 'REDUCE_ENERGY'; deltaKcal: number; newEnergyKcal: number }
  | { kind: 'INCREASE_STEPS'; extraStepsPerDay: number };

export type AdaptationResult =
  | { kind: 'NO_CHANGE'; reasons: RationaleCode[]; trend: Trend | null }
  | {
      kind: 'ADJUST_ENERGY';
      deltaKcal: number;
      newEnergyKcal: number;
      reasons: RationaleCode[];
      trend: Trend;
    }
  | { kind: 'PLATEAU'; options: PlateauOption[]; reasons: RationaleCode[]; trend: Trend };

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Exponentially weighted daily trend (α = 0.1) from the first weigh-in to `asOf`. Days without a
 * weigh-in carry the trend forward; several weigh-ins on one day are averaged first.
 */
export function weightTrend(weighIns: readonly WeighIn[], asOf: string): Map<string, Decimal> {
  const byDay = new Map<string, Decimal[]>();
  for (const w of weighIns) {
    if (w.date > asOf) continue;
    const list = byDay.get(w.date) ?? [];
    list.push(dec(w.weightKg));
    byDay.set(w.date, list);
  }
  const days = [...byDay.keys()].sort();
  const trend = new Map<string, Decimal>();
  if (days.length === 0) return trend;

  const avg = (xs: Decimal[]) => xs.reduce((a, b) => a.plus(b), new Dec(0)).div(xs.length);
  let value = avg(byDay.get(days[0]!)!);
  const span = daysBetween(days[0]!, asOf);
  for (let i = 0; i <= span; i++) {
    const day = addDays(days[0]!, i);
    const ws = byDay.get(day);
    if (ws && i > 0) value = value.plus(avg(ws).minus(value).times(TREND_ALPHA));
    trend.set(day, value);
  }
  return trend;
}

/** Weekly % change of the trend, most recent week first, for as many whole weeks as exist. */
export function weeklyRates(trend: Map<string, Decimal>, asOf: string, weeks: number): number[] {
  const rates: number[] = [];
  for (let k = 0; k < weeks; k++) {
    const end = trend.get(addDays(asOf, -7 * k));
    const start = trend.get(addDays(asOf, -7 * (k + 1)));
    if (!end || !start) break;
    rates.push(end.minus(start).div(start).times(100).toNumber());
  }
  return rates;
}

export function adaptTargets(input: AdaptTargetsInput): AdaptationResult {
  ensure(input.adherence >= 0 && input.adherence <= 1, 'adherence must be 0–1');
  ensure(input.currentEnergyKcal >= input.floorKcal, 'current target is below the floor');

  const counted = input.weighIns.filter((w) => w.date <= input.asOf);
  const trendMap = weightTrend(counted, input.asOf);
  const first = [...trendMap.keys()][0];
  if (!first || counted.length < MIN_WEIGH_INS || daysBetween(first, input.asOf) < MIN_SPAN_DAYS) {
    return { kind: 'NO_CHANGE', reasons: ['INSUFFICIENT_DATA'], trend: null };
  }

  const trend: Trend = {
    currentKg: trendMap.get(input.asOf)!,
    weeklyRatesPct: weeklyRates(trendMap, input.asOf, PLATEAU_WEEKS),
  };
  const display = { ...trend, weeklyRatesPct: trend.weeklyRatesPct.map((r) => round(r, 2)) };

  // Low adherence: the numbers are unreliable, so no target change (coach suggests a simpler plan).
  if (input.adherence < MIN_ADHERENCE) {
    return { kind: 'NO_CHANGE', reasons: ['LOW_ADHERENCE'], trend: display };
  }

  // Plateau (E5): fat loss, trend flat for 3 weeks, and the user really is following the plan.
  const rates = trend.weeklyRatesPct;
  if (
    input.goal === 'FAT_LOSS' &&
    input.adherence >= PLATEAU_MIN_ADHERENCE &&
    rates.length >= PLATEAU_WEEKS &&
    rates.slice(0, PLATEAU_WEEKS).every((r) => Math.abs(r) <= PLATEAU_BAND_PCT)
  ) {
    const options: PlateauOption[] = [];
    const reduced = Math.max(input.floorKcal, input.currentEnergyKcal - PLATEAU_ENERGY_STEP_KCAL);
    if (reduced < input.currentEnergyKcal) {
      options.push({
        kind: 'REDUCE_ENERGY',
        deltaKcal: reduced - input.currentEnergyKcal,
        newEnergyKcal: reduced,
      });
    }
    options.push({ kind: 'INCREASE_STEPS', extraStepsPerDay: PLATEAU_EXTRA_STEPS });
    const reasons: RationaleCode[] = ['PLATEAU'];
    if (reduced === input.floorKcal && options.length === 1) reasons.push('FLOOR_REACHED');
    return { kind: 'PLATEAU', options, reasons, trend: display };
  }

  // Off-goal for the last 2 weeks in the same direction → ±100–150 kcal, never below the floor.
  const recent = rates.slice(0, 2);
  const gaps = recent.map((r) => r - input.goalRatePctPerWeek);
  const tooSlowOrGaining = gaps.length === 2 && gaps.every((g) => g > RATE_GAP_PCT);
  const tooFast = gaps.length === 2 && gaps.every((g) => g < -RATE_GAP_PCT);
  if (!tooSlowOrGaining && !tooFast) {
    return { kind: 'NO_CHANGE', reasons: ['ON_TRACK'], trend: display };
  }

  const meanGap = Math.abs((gaps[0]! + gaps[1]!) / 2);
  const step = meanGap > LARGE_RATE_GAP_PCT ? LARGE_STEP_KCAL : SMALL_STEP_KCAL;
  const reason: RationaleCode = tooSlowOrGaining
    ? 'TREND_ABOVE_GOAL_RATE'
    : 'TREND_BELOW_GOAL_RATE';
  const target = input.currentEnergyKcal + (tooSlowOrGaining ? -step : step);
  const newEnergyKcal = Math.max(input.floorKcal, target);
  if (newEnergyKcal === input.currentEnergyKcal) {
    return { kind: 'NO_CHANGE', reasons: [reason, 'FLOOR_REACHED'], trend: display };
  }
  const reasons: RationaleCode[] = [reason];
  if (newEnergyKcal !== target) reasons.push('FLOOR_APPLIED');
  return {
    kind: 'ADJUST_ENERGY',
    deltaKcal: newEnergyKcal - input.currentEnergyKcal,
    newEnergyKcal,
    reasons,
    trend: display,
  };
}
