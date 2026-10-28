import type { Confidence, FoodFlag, FoodSource, FoodState, HouseholdUnit } from '@aura/contracts';
import type { DietType } from '@aura/domain/nutrition';
import type { NutrientValues } from './nutrients';

/**
 * What importers write: one catalogue food, identified by (source, sourceRef). Importers turn
 * curated content, USDA FDC and IFCT files into these, and the catalogue writer plans and applies
 * them idempotently.
 */
export interface FoodRecord {
  slug: string | null;
  name: string;
  localNames: string[];
  source: FoodSource;
  sourceRef: string;
  confidence: Confidence;
  state: FoodState;
  category: string | null;
  cuisine: string | null;
  flags: FoodFlag[];
  allergens: string[];
  densityGPerMl: number | null;
  yieldFactor: number | null;
  /** sourceRef of the raw food (same source) this cooked form converts from. */
  rawEquivalentRef: string | null;
  nutrients: NutrientValues;
  units: HouseholdUnit[];
  /** "nutrition" while a nutritionist must sign the values off. */
  reviewRequired: string | null;
}

export interface RecipeRecord {
  slug: string;
  name: string;
  localNames: string[];
  cuisine: string | null;
  region: string | null;
  mealSlots: string[];
  servings: number;
  cookedYieldG: number;
  yieldMeasured: boolean;
  restaurantStyle: boolean;
  prepMinutes: number;
  cookMinutes: number;
  costTier: number;
  steps: string[];
  /** Ingredients by the sourceRef of a CURATED_INGREDIENT food; grams are raw weight. */
  ingredients: { ref: string; grams: number; note: string | null }[];
  substitutions: { ingredientRef: string; alternatives: string[]; note: string | null }[];
  units: HouseholdUnit[];
  reviewRequired: string | null;
  /** Derived from the ingredients by the composite engine; never hand-entered. */
  derived?: RecipeDerived;
}

export interface RecipeDerived {
  dietTags: DietType[];
  allergens: string[];
  flags: FoodFlag[];
  fastingOk: boolean;
  oilG: number;
}
