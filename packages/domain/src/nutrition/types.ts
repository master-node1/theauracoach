/**
 * Vocabulary shared by the nutrition engines. The literals mirror packages/contracts (profile API)
 * but are declared here because domain code imports nothing outside itself.
 */

export type Sex = 'FEMALE' | 'MALE';
export type ActivityLevel = 'SEDENTARY' | 'LIGHT' | 'MODERATE' | 'ACTIVE' | 'VERY_ACTIVE';
export type Experience = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type Goal = 'FAT_LOSS' | 'MUSCLE_GAIN' | 'STRENGTH' | 'ENDURANCE' | 'GENERAL_FITNESS';
export type DietType =
  'VEGETARIAN' | 'EGGETARIAN' | 'NON_VEGETARIAN' | 'VEGAN' | 'JAIN' | 'PESCATARIAN';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type FoodState = 'RAW' | 'COOKED';
export type MealSlot = 'BREAKFAST' | 'LUNCH' | 'SNACK' | 'DINNER';

export const NUTRIENT_KEYS = [
  'energyKcal',
  'proteinG',
  'carbsG',
  'fatG',
  'fibreG',
  'sugarG',
  'sodiumMg',
  'ironMg',
  'calciumMg',
  'vitaminB12Ug',
  'vitaminDUg',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/**
 * Ingredient facts that diet rules and hard filters read. Set on catalogue foods by the content team;
 * recipes never carry their own tags, they derive them from ingredients (LLD §6.1).
 */
export const FOOD_FLAGS = [
  'MEAT',
  'FISH',
  'EGG',
  'DAIRY',
  'HONEY',
  'ROOT_VEGETABLE',
  'ONION',
  'GARLIC',
  'FASTING_OK',
  'OIL',
] as const;
export type FoodFlag = (typeof FOOD_FLAGS)[number];

const CONFIDENCE_ORDER: Confidence[] = ['LOW', 'MEDIUM', 'HIGH'];

export function lowerConfidence(c: Confidence, levels = 1): Confidence {
  const i = Math.max(0, CONFIDENCE_ORDER.indexOf(c) - levels);
  return CONFIDENCE_ORDER[i]!;
}

export function minConfidence(values: Iterable<Confidence>): Confidence {
  let best = 2;
  for (const c of values) best = Math.min(best, CONFIDENCE_ORDER.indexOf(c));
  return CONFIDENCE_ORDER[best]!;
}
