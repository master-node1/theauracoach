import type Decimal from 'decimal.js';
import { dec, Dec, type Numeric } from './decimal';
import { ensure, NutritionDomainError } from './errors';
import type { RationaleCode } from './rationale';
import {
  lowerConfidence,
  NUTRIENT_KEYS,
  type Confidence,
  type FoodState,
  type NutrientKey,
} from './types';

/** Nutrition LLD §3 (serving normalisation). */

/** Nutrients per 100 g. Missing keys mean "not known", not zero. */
export type NutrientProfile = Partial<Record<NutrientKey, Numeric>>;
export type NutrientAmounts = Partial<Record<NutrientKey, Decimal>>;

export interface HouseholdUnit {
  /** e.g. `katori`, `roti`, `tbsp`, `piece`, `pack`. */
  code: string;
  grams: Numeric;
}

export interface CataloguedForm {
  per100g: NutrientProfile;
  confidence: Confidence;
}

export interface ServingFood extends CataloguedForm {
  id: string;
  state: FoodState;
  /** Needed for `ml`; foods without it cannot be logged by volume. */
  densityGPerMl?: Numeric;
  units?: HouseholdUnit[];
  /** Cooked grams per raw gram (e.g. rice ≈ 2.5). Used when no cooked form exists. */
  yieldFactor?: Numeric;
  /** For a COOKED food: the profile of its raw ingredients, per 100 g raw. */
  rawEquivalent?: CataloguedForm;
  /** For a RAW food: its catalogued cooked form, if any. */
  cookedForm?: CataloguedForm;
}

export interface ServingInput {
  food: ServingFood;
  quantity: Numeric;
  /** `g`, `kg`, `ml`, or a household unit code from `food.units`. */
  unitCode: string;
  /** The state the user ate it in. Defaults to the food's own state. */
  state?: FoodState;
}

export interface NormalisedServing {
  /** Grams as eaten. */
  grams: Decimal;
  nutrients: NutrientAmounts;
  confidence: Confidence;
  rationale: RationaleCode[];
}

export function unitToGrams(food: ServingFood, quantity: Numeric, unitCode: string): Decimal {
  const q = dec(quantity);
  ensure(q.isFinite() && q.gt(0), 'quantity must be positive');
  switch (unitCode) {
    case 'g':
      return q;
    case 'kg':
      return q.times(1000);
    case 'ml':
      if (food.densityGPerMl === undefined) {
        throw new NutritionDomainError(
          'UNIT_NOT_SUPPORTED',
          `Food ${food.id} has no density, so it cannot be logged in ml`,
        );
      }
      return q.times(food.densityGPerMl);
    default: {
      const unit = food.units?.find((u) => u.code === unitCode);
      if (!unit) {
        throw new NutritionDomainError(
          'UNIT_NOT_SUPPORTED',
          `Unit ${unitCode} is not defined for food ${food.id}`,
        );
      }
      return q.times(unit.grams);
    }
  }
}

/** per100 × grams / 100 for each known nutrient. Decimal throughout; round at display only. */
export function scaleNutrients(per100g: NutrientProfile, grams: Numeric): NutrientAmounts {
  const factor = dec(grams).div(100);
  const out: NutrientAmounts = {};
  for (const key of NUTRIENT_KEYS) {
    const v = per100g[key];
    if (v !== undefined) out[key] = dec(v).times(factor);
  }
  return out;
}

export function addNutrients(a: NutrientAmounts, b: NutrientAmounts): NutrientAmounts {
  const out: NutrientAmounts = { ...a };
  for (const key of NUTRIENT_KEYS) {
    const v = b[key];
    if (v !== undefined) out[key] = (out[key] ?? new Dec(0)).plus(v);
  }
  return out;
}

export function normaliseServing({
  food,
  quantity,
  unitCode,
  state,
}: ServingInput): NormalisedServing {
  const grams = unitToGrams(food, quantity, unitCode);
  const eaten = state ?? food.state;

  if (eaten === food.state) {
    return {
      grams,
      nutrients: scaleNutrients(food.per100g, grams),
      confidence: food.confidence,
      rationale: ['STATE_AS_CATALOGUED'],
    };
  }

  if (eaten === 'RAW') {
    // Logging RAW but the food is catalogued COOKED: use its raw equivalent with the grams as given.
    if (!food.rawEquivalent) {
      throw new NutritionDomainError('STATE_NOT_SUPPORTED', `Food ${food.id} has no raw form`);
    }
    return {
      grams,
      nutrients: scaleNutrients(food.rawEquivalent.per100g, grams),
      confidence: food.rawEquivalent.confidence,
      rationale: ['RAW_EQUIVALENT_USED'],
    };
  }

  // Logging COOKED but the food is catalogued RAW.
  if (food.cookedForm) {
    return {
      grams,
      nutrients: scaleNutrients(food.cookedForm.per100g, grams),
      confidence: food.cookedForm.confidence,
      rationale: ['COOKED_FORM_USED'],
    };
  }
  if (food.yieldFactor === undefined || dec(food.yieldFactor).lte(0)) {
    throw new NutritionDomainError(
      'STATE_NOT_SUPPORTED',
      `Food ${food.id} has no cooked form or yield factor`,
    );
  }
  const rawGrams = grams.div(food.yieldFactor);
  return {
    grams,
    nutrients: scaleNutrients(food.per100g, rawGrams),
    confidence: lowerConfidence(food.confidence),
    rationale: ['YIELD_CONVERSION'],
  };
}
