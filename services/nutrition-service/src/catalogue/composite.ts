import type { DietType, FoodFlag } from '@aura/contracts';
import { compositeRecipe, type CompositeRecipe } from '@aura/domain/nutrition';
import { round3, type NutrientValues } from './nutrients';

export interface CompositeIngredient {
  id: string;
  grams: number;
  nutrients: NutrientValues;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  allergens: readonly string[];
  flags: readonly string[];
}

export interface CompositeResult {
  nutrients: NutrientValues;
  confidence: CompositeRecipe['confidence'];
  allergens: string[];
  flags: FoodFlag[];
  dietTags: DietType[];
  fastingOk: boolean;
  oilG: number;
}

/**
 * The composite dish users log (nutrition LLD §4): per-100 g values of the cooked recipe from its
 * raw ingredients and yield, with allergens, flags and diets derived, never hand-entered.
 */
export function buildComposite(input: {
  ingredients: CompositeIngredient[];
  cookedYieldG: number;
  yieldMeasured: boolean;
  restaurantStyle: boolean;
}): CompositeResult {
  const result = compositeRecipe({
    ingredients: input.ingredients.map((i) => ({
      grams: i.grams,
      food: {
        id: i.id,
        per100g: i.nutrients,
        confidence: i.confidence,
        allergens: i.allergens,
        flags: i.flags as FoodFlag[],
      },
    })),
    cookedYieldG: input.cookedYieldG,
    yieldMeasured: input.yieldMeasured,
    restaurantStyle: input.restaurantStyle,
  });
  const nutrients: NutrientValues = {};
  for (const [key, value] of Object.entries(result.per100g)) {
    nutrients[key as keyof NutrientValues] = round3(value.toNumber());
  }
  return {
    nutrients,
    confidence: result.confidence,
    allergens: result.allergens,
    flags: result.flags,
    dietTags: result.compatibleDiets,
    fastingOk: result.fastingOk,
    oilG: Math.round(result.oilG.toNumber() * 10) / 10,
  };
}
