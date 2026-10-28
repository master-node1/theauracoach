import { clamp, Dec, round, type Numeric } from './decimal';
import { ensure } from './errors';
import type { NoticeCode, RationaleCode } from './rationale';
import type { ActivityLevel, Experience, Goal, Sex } from './types';
import type Decimal from 'decimal.js';

/** Nutrition LLD §2 (targets engine). Every figure is an estimate and is labelled "≈" in the apps. */

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

/** Protein target in g per kg of reference bodyweight, by goal. */
export const PROTEIN_G_PER_KG: Record<Goal, number> = {
  FAT_LOSS: 1.8,
  MUSCLE_GAIN: 1.8,
  STRENGTH: 1.6,
  ENDURANCE: 1.4,
  GENERAL_FITNESS: 1.2,
};

export const KCAL_PER_KG_BODY_MASS = 7700;
export const DEFAULT_WEEKLY_LOSS_PCT = 0.5;
export const MAX_WEEKLY_LOSS_PCT = 1;
export const DEFICIT_MIN_KCAL = 250;
export const DEFICIT_MAX_KCAL = 750;
export const SURPLUS_KCAL = 250;
export const SURPLUS_BEGINNER_KCAL = 350;
export const ENDURANCE_BONUS_PCT = 5;
export const ENDURANCE_BONUS_MIN_SESSIONS = 5;
export const ENERGY_FLOOR_KCAL: Record<Sex, number> = { FEMALE: 1200, MALE: 1500 };
export const ADJUSTED_WEIGHT_BMI_THRESHOLD = 30;
export const ADJUSTED_WEIGHT_BMI = 27;
export const FAT_ENERGY_SHARE = 0.25;
export const FAT_MIN_G_PER_KG = 0.6;
export const CARB_MIN_G = 130;
export const FIBRE_G_PER_1000_KCAL = 14;
export const FIBRE_MIN_G = 25;
export const WATER_ML_PER_KG = 35;
export const WATER_TRAINING_DAY_EXTRA_ML = 500;

export interface BodyInput {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
}

export interface TargetsInput extends BodyInput {
  activityLevel: ActivityLevel;
  goal: Goal;
  experience?: Experience;
  /** Planned sessions per week (endurance bonus, water on training days). */
  trainingDaysPerWeek?: number;
  /** Requested fat-loss rate in % bodyweight per week; default 0.5, capped at `maxWeeklyLossPct`. */
  weeklyLossPct?: number;
  /** Policy `max_weekly_loss_pct`; defaults to 1. */
  maxWeeklyLossPct?: number;
  pregnant?: boolean;
  /** Low-carb option (P2): carbs are not raised to the 130 g minimum. */
  lowCarb?: boolean;
}

export interface MicroTargets {
  ironMg: number;
  calciumMg: number;
  vitaminB12Ug: number;
  vitaminDUg: number;
  /** Upper limit, not a target. */
  sodiumMaxMg: number;
}

export interface NutritionTargets {
  energyKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fibreG: number;
  waterMl: { restDay: number; trainingDay: number };
  micros: MicroTargets;
  /** Intermediate values, unrounded, for audit and the "how we got this" sheet. */
  basis: {
    bmrKcal: Decimal;
    tdeeKcal: Decimal;
    floorKcal: number;
    referenceWeightKg: Decimal;
    goalAdjustmentKcal: Decimal;
    weeklyLossPct: number | null;
  };
  rationale: RationaleCode[];
  notices: NoticeCode[];
  estimate: true;
}

export function validateBody(input: BodyInput): void {
  ensure(input.ageYears >= 18 && input.ageYears <= 100, 'ageYears must be 18–100');
  ensure(input.heightCm >= 100 && input.heightCm <= 250, 'heightCm must be 100–250');
  ensure(input.weightKg >= 30 && input.weightKg <= 300, 'weightKg must be 30–300');
}

/** Mifflin-St Jeor: 10w + 6.25h − 5a + 5 (male) / − 161 (female). */
export function bmr({ sex, ageYears, heightCm, weightKg }: BodyInput): Decimal {
  const base = new Dec(10)
    .times(weightKg)
    .plus(new Dec(6.25).times(heightCm))
    .minus(new Dec(5).times(ageYears));
  return sex === 'MALE' ? base.plus(5) : base.minus(161);
}

export function tdee(input: BodyInput & { activityLevel: ActivityLevel }): Decimal {
  return bmr(input).times(ACTIVITY_FACTORS[input.activityLevel]);
}

export function bmiOf(heightCm: Numeric, weightKg: Numeric): Decimal {
  const m = new Dec(heightCm).div(100);
  return new Dec(weightKg).div(m.pow(2));
}

/** Safety floor: max(BMR, 1200 kcal female / 1500 kcal male). Not overridable by the coach. */
export function energyFloor(input: BodyInput): number {
  return Math.max(round(bmr(input)), ENERGY_FLOOR_KCAL[input.sex]);
}

/** Bodyweight protein is scaled by: the weight at BMI 27 when BMI ≥ 30. */
export function referenceWeight(heightCm: number, weightKg: number): Decimal {
  if (bmiOf(heightCm, weightKg).gte(ADJUSTED_WEIGHT_BMI_THRESHOLD)) {
    return new Dec(ADJUSTED_WEIGHT_BMI).times(new Dec(heightCm).div(100).pow(2));
  }
  return new Dec(weightKg);
}

/**
 * Selected micronutrients, ICMR-NIN 2020 RDA for adults (sedentary-to-moderate reference).
 * Women ≥ 50 are treated as post-menopausal (iron as men, calcium 1200 mg). Values need sign-off
 * from the reviewing nutritionist before beta (TAC-44).
 */
export function microTargets(sex: Sex, ageYears: number, pregnant = false): MicroTargets {
  const sodiumMaxMg = 2000;
  const vitaminDUg = 15;
  if (sex === 'FEMALE' && pregnant) {
    return { ironMg: 27, calciumMg: 1000, vitaminB12Ug: 2.5, vitaminDUg, sodiumMaxMg };
  }
  if (sex === 'FEMALE') {
    const post = ageYears >= 50;
    return {
      ironMg: post ? 19 : 29,
      calciumMg: post ? 1200 : 1000,
      vitaminB12Ug: 2.5,
      vitaminDUg,
      sodiumMaxMg,
    };
  }
  return {
    ironMg: 19,
    calciumMg: ageYears >= 50 ? 1200 : 1000,
    vitaminB12Ug: 2.5,
    vitaminDUg,
    sodiumMaxMg,
  };
}

export function calculateTargets(input: TargetsInput): NutritionTargets {
  validateBody(input);
  const rationale: RationaleCode[] = ['BMR_MIFFLIN_ST_JEOR', 'TDEE_ACTIVITY_FACTOR'];
  const notices: NoticeCode[] = ['ESTIMATE'];
  const pregnant = input.sex === 'FEMALE' && input.pregnant === true;
  const sessions = input.trainingDaysPerWeek ?? 0;
  ensure(sessions >= 0 && sessions <= 7, 'trainingDaysPerWeek must be 0–7');

  const bmrKcal = bmr(input);
  const tdeeKcal = tdee(input);
  const floorKcal = energyFloor(input);

  // 3. Goal adjustment
  let adjustment = new Dec(0);
  let weeklyLossPct: number | null = null;
  if (pregnant) {
    rationale.push('PREGNANCY_MAINTENANCE');
    notices.push('PROFESSIONAL_ADVICE_PREGNANCY');
  } else if (input.goal === 'FAT_LOSS') {
    const maxPct = input.maxWeeklyLossPct ?? MAX_WEEKLY_LOSS_PCT;
    let pct = input.weeklyLossPct ?? DEFAULT_WEEKLY_LOSS_PCT;
    ensure(pct > 0, 'weeklyLossPct must be positive');
    if (pct > maxPct) {
      pct = maxPct;
      rationale.push('RATE_CAPPED');
    }
    weeklyLossPct = pct;
    const raw = new Dec(input.weightKg).times(pct).div(100).times(KCAL_PER_KG_BODY_MASS).div(7);
    const deficit = clamp(raw, DEFICIT_MIN_KCAL, DEFICIT_MAX_KCAL);
    if (!deficit.eq(raw)) rationale.push('DEFICIT_CLAMPED');
    adjustment = deficit.neg();
    rationale.push('GOAL_DEFICIT');
  } else if (input.goal === 'MUSCLE_GAIN') {
    const beginner = input.experience === 'BEGINNER';
    adjustment = new Dec(beginner ? SURPLUS_BEGINNER_KCAL : SURPLUS_KCAL);
    rationale.push(beginner ? 'GOAL_SURPLUS_BEGINNER' : 'GOAL_SURPLUS');
  } else {
    rationale.push('GOAL_MAINTENANCE');
    if (input.goal === 'ENDURANCE' && sessions >= ENDURANCE_BONUS_MIN_SESSIONS) {
      adjustment = tdeeKcal.times(ENDURANCE_BONUS_PCT).div(100);
      rationale.push('ENDURANCE_VOLUME_BONUS');
    }
  }

  // 4. Safety floor
  let energy = tdeeKcal.plus(adjustment);
  if (energy.lt(floorKcal)) {
    energy = new Dec(floorKcal);
    rationale.push('FLOOR_APPLIED');
  }
  let energyKcal = round(energy);

  // 5. Protein
  const refWeight = referenceWeight(input.heightCm, input.weightKg);
  if (!refWeight.eq(input.weightKg)) rationale.push('PROTEIN_ADJUSTED_WEIGHT');
  const proteinG = round(refWeight.times(PROTEIN_G_PER_KG[input.goal]));

  // 6. Fat: 25% of energy, at least 0.6 g/kg
  const fatMin = refWeight.times(FAT_MIN_G_PER_KG);
  let fat = new Dec(energyKcal).times(FAT_ENERGY_SHARE).div(9);
  if (fat.lt(fatMin)) {
    fat = fatMin;
    rationale.push('FAT_MIN_APPLIED');
  }
  const fatG = round(fat);

  // 7. Carbs: remainder, at least 130 g unless low-carb was chosen. Raising carbs raises energy.
  let carbs = new Dec(energyKcal)
    .minus(proteinG * 4)
    .minus(fatG * 9)
    .div(4);
  if (input.lowCarb) {
    rationale.push('LOW_CARB_CHOSEN');
    carbs = Dec.max(carbs, 0);
  } else if (carbs.lt(CARB_MIN_G)) {
    carbs = new Dec(CARB_MIN_G);
    rationale.push('CARB_MIN_APPLIED');
    energyKcal = proteinG * 4 + fatG * 9 + CARB_MIN_G * 4;
  }
  const carbsG = round(carbs);

  // 8. Fibre and water
  let fibre = new Dec(energyKcal).times(FIBRE_G_PER_1000_KCAL).div(1000);
  if (fibre.lt(FIBRE_MIN_G)) {
    fibre = new Dec(FIBRE_MIN_G);
    rationale.push('FIBRE_MIN_APPLIED');
  }
  const restWater = round(new Dec(input.weightKg).times(WATER_ML_PER_KG));

  // 9. Micros
  rationale.push('MICROS_ICMR_NIN_2020');

  return {
    energyKcal,
    proteinG,
    fatG,
    carbsG,
    fibreG: round(fibre),
    waterMl: { restDay: restWater, trainingDay: restWater + WATER_TRAINING_DAY_EXTRA_ML },
    micros: microTargets(input.sex, input.ageYears, pregnant),
    basis: {
      bmrKcal,
      tdeeKcal,
      floorKcal,
      referenceWeightKg: refWeight,
      goalAdjustmentKcal: adjustment,
      weeklyLossPct,
    },
    rationale,
    notices,
    estimate: true,
  };
}
