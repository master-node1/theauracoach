import type { DietType, FoodFlag } from './types';

/** Ingredient flags each diet excludes. Jain is lacto-vegetarian without root vegetables, onion, garlic. */
export const DIET_EXCLUSIONS: Record<DietType, readonly FoodFlag[]> = {
  NON_VEGETARIAN: [],
  PESCATARIAN: ['MEAT'],
  EGGETARIAN: ['MEAT', 'FISH'],
  VEGETARIAN: ['MEAT', 'FISH', 'EGG'],
  VEGAN: ['MEAT', 'FISH', 'EGG', 'DAIRY', 'HONEY'],
  JAIN: ['MEAT', 'FISH', 'EGG', 'HONEY', 'ROOT_VEGETABLE', 'ONION', 'GARLIC'],
};

export function fitsDiet(diet: DietType, flags: Iterable<FoodFlag>): boolean {
  const excluded = DIET_EXCLUSIONS[diet];
  for (const f of flags) if (excluded.includes(f)) return false;
  return true;
}

/** Diets a set of ingredient flags is compatible with, for labelling recipes. */
export function compatibleDiets(flags: Iterable<FoodFlag>): DietType[] {
  const list = [...flags];
  return (Object.keys(DIET_EXCLUSIONS) as DietType[]).filter((d) => fitsDiet(d, list));
}
