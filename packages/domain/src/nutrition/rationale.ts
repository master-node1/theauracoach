/**
 * Rationale and notice codes the engines attach to their outputs. Services store them
 * (e.g. `NutritionTarget.rationale`) and the apps translate them; the list is documented in
 * docs/modules/nutrition/LLD.md §9.
 */
export const RATIONALE_CODES = [
  // targets
  'BMR_MIFFLIN_ST_JEOR',
  'TDEE_ACTIVITY_FACTOR',
  'GOAL_DEFICIT',
  'DEFICIT_CLAMPED',
  'RATE_CAPPED',
  'GOAL_SURPLUS',
  'GOAL_SURPLUS_BEGINNER',
  'GOAL_MAINTENANCE',
  'ENDURANCE_VOLUME_BONUS',
  'FLOOR_APPLIED',
  'PREGNANCY_MAINTENANCE',
  'PROTEIN_ADJUSTED_WEIGHT',
  'FAT_MIN_APPLIED',
  'CARB_MIN_APPLIED',
  'LOW_CARB_CHOSEN',
  'FIBRE_MIN_APPLIED',
  'MICROS_ICMR_NIN_2020',
  // assessment
  'BMI_ASIA_PACIFIC_CUTOFFS',
  // serving normalisation
  'STATE_AS_CATALOGUED',
  'RAW_EQUIVALENT_USED',
  'COOKED_FORM_USED',
  'YIELD_CONVERSION',
  // composite recipes
  'YIELD_ESTIMATED',
  'LOW_CONFIDENCE_INGREDIENT',
  'RESTAURANT_FAT_NOTE',
  // meal plans
  'RELAXED_VARIETY',
  'RELAXED_PREP_TIME',
  'UNSATISFIABLE_SLOT',
  'DAY_TARGET_NOT_MET',
  // adaptation
  'INSUFFICIENT_DATA',
  'LOW_ADHERENCE',
  'ON_TRACK',
  'TREND_ABOVE_GOAL_RATE',
  'TREND_BELOW_GOAL_RATE',
  'FLOOR_REACHED',
  'PLATEAU',
] as const;
export type RationaleCode = (typeof RATIONALE_CODES)[number];

/** Notices the apps must show next to the numbers. */
export type NoticeCode = 'ESTIMATE' | 'PROFESSIONAL_ADVICE_PREGNANCY' | 'BMI_POPULATION_CAVEAT';
