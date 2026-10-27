import type Decimal from 'decimal.js';
import { dec, sum, type Numeric } from './decimal';
import { compatibleDiets } from './diet';
import { NutritionDomainError } from './errors';
import {
  addNutrients,
  scaleNutrients,
  type HouseholdUnit,
  type NutrientAmounts,
  type NutrientProfile,
} from './normalise-serving';
import type { RationaleCode } from './rationale';
import { NUTRIENT_KEYS, type Confidence, type DietType, type FoodFlag } from './types';

/** Nutrition LLD §4 (composite Indian dishes). */

export interface IngredientFood {
  id: string;
  /** Nutrients per 100 g of the ingredient as weighed (raw). */
  per100g: NutrientProfile;
  confidence: Confidence;
  allergens: readonly string[];
  flags: readonly FoodFlag[];
}

export interface RecipeIngredient {
  food: IngredientFood;
  /** Raw grams in the whole recipe. */
  grams: Numeric;
}

export interface CompositeRecipeInput {
  ingredients: RecipeIngredient[];
  /** Weight of the finished dish. */
  cookedYieldG: Numeric;
  /** True when the yield was weighed, false when estimated. */
  yieldMeasured: boolean;
  householdUnits?: HouseholdUnit[];
  /** Restaurant-style variant: apps show a "+30% fat when eaten out" note. */
  restaurantStyle?: boolean;
}

export interface CompositeRecipe {
  per100g: NutrientAmounts;
  totals: NutrientAmounts;
  cookedYieldG: Decimal;
  rawWeightG: Decimal;
  /** Oil is explicit: the grams of ingredients flagged OIL. */
  oilG: Decimal;
  householdUnits: HouseholdUnit[];
  confidence: Confidence;
  /** Union of ingredient allergens. Recipes never carry hand-entered allergen tags. */
  allergens: string[];
  flags: FoodFlag[];
  compatibleDiets: DietType[];
  fastingOk: boolean;
  rationale: RationaleCode[];
}

export function deriveAllergens(foods: Iterable<{ allergens: readonly string[] }>): string[] {
  const set = new Set<string>();
  for (const f of foods) for (const a of f.allergens) set.add(a);
  return [...set].sort();
}

export function deriveFlags(foods: Iterable<{ flags: readonly FoodFlag[] }>): FoodFlag[] {
  const list = [...foods];
  const set = new Set<FoodFlag>();
  for (const f of list) for (const flag of f.flags) if (flag !== 'FASTING_OK') set.add(flag);
  // A dish is fasting-friendly only if every ingredient is.
  if (list.length > 0 && list.every((f) => f.flags.includes('FASTING_OK'))) set.add('FASTING_OK');
  return [...set].sort();
}

export function compositeRecipe(input: CompositeRecipeInput): CompositeRecipe {
  if (input.ingredients.length === 0) {
    throw new NutritionDomainError('INVALID_RECIPE', 'A recipe needs at least one ingredient');
  }
  const cookedYieldG = dec(input.cookedYieldG);
  if (!cookedYieldG.isFinite() || cookedYieldG.lte(0)) {
    throw new NutritionDomainError('INVALID_RECIPE', 'cookedYieldG must be positive');
  }
  for (const i of input.ingredients) {
    if (dec(i.grams).lte(0)) {
      throw new NutritionDomainError('INVALID_RECIPE', `Ingredient ${i.food.id} has no grams`);
    }
  }

  let totals: NutrientAmounts = {};
  for (const i of input.ingredients)
    totals = addNutrients(totals, scaleNutrients(i.food.per100g, i.grams));

  const per100g: NutrientAmounts = {};
  for (const key of NUTRIENT_KEYS) {
    const v = totals[key];
    if (v !== undefined) per100g[key] = v.div(cookedYieldG).times(100);
  }

  const rationale: RationaleCode[] = [];
  let confidence: Confidence = 'HIGH';
  if (!input.yieldMeasured) {
    confidence = 'MEDIUM';
    rationale.push('YIELD_ESTIMATED');
  }
  if (input.ingredients.some((i) => i.food.confidence === 'LOW')) {
    confidence = 'LOW';
    rationale.push('LOW_CONFIDENCE_INGREDIENT');
  } else if (input.ingredients.some((i) => i.food.confidence === 'MEDIUM')) {
    confidence = 'MEDIUM';
  }
  if (input.restaurantStyle) rationale.push('RESTAURANT_FAT_NOTE');

  const foods = input.ingredients.map((i) => i.food);
  const flags = deriveFlags(foods);
  return {
    per100g,
    totals,
    cookedYieldG,
    rawWeightG: sum(input.ingredients.map((i) => i.grams)),
    oilG: sum(input.ingredients.filter((i) => i.food.flags.includes('OIL')).map((i) => i.grams)),
    householdUnits: input.householdUnits ?? [],
    confidence,
    allergens: deriveAllergens(foods),
    flags,
    compatibleDiets: compatibleDiets(flags),
    fastingOk: flags.includes('FASTING_OK'),
    rationale,
  };
}
