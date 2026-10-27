import { Dec, round } from './decimal';
import { ensure } from './errors';
import type { NoticeCode, RationaleCode } from './rationale';
import {
  bmiOf,
  bmr,
  DEFAULT_WEEKLY_LOSS_PCT,
  MAX_WEEKLY_LOSS_PCT,
  tdee,
  validateBody,
  type BodyInput,
} from './targets';
import type { ActivityLevel, Goal } from './types';

/** Body assessment shown during onboarding (onboarding LLD, plan reveal). */

/** Asia-Pacific BMI cut-offs (WHO expert consultation 2004): overweight from 23, obese from 27.5. */
export const BMI_CUTOFFS = { underweight: 18.5, overweight: 23, obese: 27.5 } as const;
export type BmiCategory = 'UNDERWEIGHT' | 'NORMAL' | 'OVERWEIGHT' | 'OBESE';

/** Weekly rate bands in % bodyweight per week. */
export const RATE_BANDS: Partial<Record<Goal, { min: number; recommended: number; max: number }>> =
  {
    FAT_LOSS: { min: 0.25, recommended: DEFAULT_WEEKLY_LOSS_PCT, max: MAX_WEEKLY_LOSS_PCT },
    MUSCLE_GAIN: { min: 0.1, recommended: 0.25, max: 0.5 },
  };

export interface AssessmentInput extends BodyInput {
  activityLevel: ActivityLevel;
  goal: Goal;
  targetWeightKg?: number;
  /** Requested rate in % bodyweight per week (loss or gain by goal). */
  requestedRatePct?: number;
  /** ISO date (YYYY-MM-DD) the dates are counted from. */
  today: string;
}

export interface Assessment {
  bmi: number;
  bmiCategory: BmiCategory;
  bmrKcal: number;
  tdeeKcal: number;
  /** null for goals that hold weight. */
  recommendedRatePct: number | null;
  rateRangePct: { min: number; max: number } | null;
  /** The rate used for dates: the request, capped at the band max. */
  ratePct: number | null;
  rateCapped: boolean;
  /** Present only when the cap applied; an explanation key for the apps. */
  capExplanation: 'MAX_RATE_FOR_SAFETY' | null;
  /** Earliest (at band max) and latest (at band min) dates the target weight is reached. */
  targetDateRange: { earliest: string; latest: string; expected: string } | null;
  rationale: RationaleCode[];
  notices: NoticeCode[];
}

export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < BMI_CUTOFFS.underweight) return 'UNDERWEIGHT';
  if (bmi < BMI_CUTOFFS.overweight) return 'NORMAL';
  if (bmi < BMI_CUTOFFS.obese) return 'OVERWEIGHT';
  return 'OBESE';
}

export function addDays(isoDate: string, days: number): string {
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(isoDate), 'dates must be YYYY-MM-DD');
  const d = new Date(`${isoDate}T00:00:00Z`);
  ensure(!Number.isNaN(d.getTime()), 'invalid date');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days to move `deltaKg` at `ratePct` %/week of the starting weight, rounded up to whole days. */
function daysAtRate(weightKg: number, deltaKg: number, ratePct: number): number {
  const perWeek = new Dec(weightKg).times(ratePct).div(100);
  return new Dec(Math.abs(deltaKg)).div(perWeek).times(7).ceil().toNumber();
}

export function assess(input: AssessmentInput): Assessment {
  validateBody(input);
  const bmi = round(bmiOf(input.heightCm, input.weightKg), 1);
  const band = RATE_BANDS[input.goal] ?? null;
  const rationale: RationaleCode[] = [
    'BMI_ASIA_PACIFIC_CUTOFFS',
    'BMR_MIFFLIN_ST_JEOR',
    'TDEE_ACTIVITY_FACTOR',
  ];

  let ratePct: number | null = null;
  let rateCapped = false;
  if (band) {
    ratePct = input.requestedRatePct ?? band.recommended;
    ensure(ratePct > 0, 'requestedRatePct must be positive');
    if (ratePct > band.max) {
      ratePct = band.max;
      rateCapped = true;
      rationale.push('RATE_CAPPED');
    }
  }

  let targetDateRange: Assessment['targetDateRange'] = null;
  if (band && ratePct !== null && input.targetWeightKg !== undefined) {
    const delta = input.targetWeightKg - input.weightKg;
    const wrongWay = input.goal === 'FAT_LOSS' ? delta >= 0 : delta <= 0;
    if (!wrongWay) {
      targetDateRange = {
        earliest: addDays(input.today, daysAtRate(input.weightKg, delta, band.max)),
        expected: addDays(input.today, daysAtRate(input.weightKg, delta, ratePct)),
        latest: addDays(input.today, daysAtRate(input.weightKg, delta, band.min)),
      };
    }
  }

  return {
    bmi,
    bmiCategory: bmiCategory(bmi),
    bmrKcal: round(bmr(input)),
    tdeeKcal: round(tdee(input)),
    recommendedRatePct: band?.recommended ?? null,
    rateRangePct: band ? { min: band.min, max: band.max } : null,
    ratePct,
    rateCapped,
    capExplanation: rateCapped ? 'MAX_RATE_FOR_SAFETY' : null,
    targetDateRange,
    rationale,
    notices: ['ESTIMATE', 'BMI_POPULATION_CAVEAT'],
  };
}
