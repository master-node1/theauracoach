import type { Allergen, FoodFlag, FoodState } from '@aura/contracts';

/**
 * Heuristics that tag imported reference foods with diet flags and allergens from their group and
 * description. They err towards tagging (a vegetarian never sees a mistagged meat), and every
 * imported food can be corrected by a reviewer in the admin console.
 */
export interface FoodClass {
  category: string;
  flags: FoodFlag[];
  allergens: Allergen[];
}

const has = (text: string, pattern: RegExp) => pattern.test(text);

export function classify(group: string, description: string): FoodClass {
  const d = description.toLowerCase();
  const flags = new Set<FoodFlag>();
  const allergens = new Set<Allergen>();
  let category = group;

  switch (group) {
    case 'meat':
    case 'poultry':
      flags.add('MEAT');
      break;
    case 'fish':
      flags.add('FISH');
      allergens.add('fish');
      break;
    case 'shellfish':
      flags.add('FISH');
      allergens.add('shellfish');
      break;
    case 'egg':
      flags.add('EGG');
      allergens.add('egg');
      break;
    case 'dairy':
      flags.add('DAIRY');
      allergens.add('milk');
      break;
    case 'fat':
      if (has(d, /butter|ghee/)) {
        flags.add('DAIRY');
        allergens.add('milk');
      } else {
        flags.add('OIL');
      }
      break;
    case 'nut':
      if (has(d, /peanut|groundnut/)) allergens.add('peanut');
      else if (has(d, /sesame|til\b/)) allergens.add('sesame');
      else if (has(d, /mustard/)) allergens.add('mustard');
      else if (!has(d, /seed|coconut/)) allergens.add('tree_nut');
      break;
  }
  if (group === 'dairy' && has(d, /\begg/)) {
    flags.delete('DAIRY');
    allergens.delete('milk');
    flags.add('EGG');
    allergens.add('egg');
    category = 'egg';
  }
  if (has(d, /\b(shrimp|prawn|crab|lobster|clam|oyster|mussel|scallop|squid|octopus)/)) {
    flags.add('FISH');
    allergens.add('shellfish');
  }
  if (has(d, /\b(wheat|barley|rye|semolina|maida|atta|bread|pasta|noodle)/)) allergens.add('gluten');
  if (has(d, /\bsoy|tofu/)) allergens.add('soy');
  if (has(d, /\bhoney\b/)) flags.add('HONEY');
  if (has(d, /\bonions?\b|shallot|leek|spring onion|scallion/)) flags.add('ONION');
  if (has(d, /\bgarlic/)) flags.add('GARLIC');
  if (
    has(d, /\b(potato|sweet potato|carrot|beet|radish|turnip|yam|colocasia|taro|ginger|tapioca|cassava)/)
  ) {
    flags.add('ROOT_VEGETABLE');
  }
  return { category, flags: [...flags].sort(), allergens: [...allergens].sort() };
}

export function stateOf(description: string, fallback: FoodState): FoodState {
  const d = description.toLowerCase();
  if (/\b(cooked|boiled|roasted|baked|fried|steamed|grilled|braised|stewed|broiled)\b/.test(d)) {
    return 'COOKED';
  }
  if (/\braw\b|\bfresh\b|\bdry\b|\bdried\b/.test(d)) return 'RAW';
  return fallback;
}
