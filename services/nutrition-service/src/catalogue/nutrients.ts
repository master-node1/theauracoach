import { NUTRIENT_KEYS, type NutrientKey } from '@aura/domain/nutrition';

/**
 * Nutrient codes as stored in `Nutrient.code` / `FoodNutrient.nutrientCode` (seeded by the
 * food_catalogue migration), keyed by the @aura/domain NutrientKey the engines and API use.
 */
export const NUTRIENT_CODES: Record<NutrientKey, string> = {
  energyKcal: 'energy_kcal',
  proteinG: 'protein_g',
  carbsG: 'carb_g',
  fatG: 'fat_g',
  fibreG: 'fibre_g',
  sugarG: 'sugar_g',
  sodiumMg: 'sodium_mg',
  ironMg: 'iron_mg',
  calciumMg: 'calcium_mg',
  vitaminB12Ug: 'vitamin_b12_ug',
  vitaminDUg: 'vitamin_d_ug',
};

const KEY_BY_CODE = new Map(NUTRIENT_KEYS.map((k) => [NUTRIENT_CODES[k], k]));

export const REQUIRED_NUTRIENTS = ['energyKcal', 'proteinG', 'carbsG', 'fatG', 'fibreG'] as const;

/** Per-100 g values keyed by NutrientKey. Missing keys mean "not known", never zero. */
export type NutrientValues = Partial<Record<NutrientKey, number>>;

export function nutrientKeyOf(code: string): NutrientKey | undefined {
  return KEY_BY_CODE.get(code);
}

/** FoodNutrient rows → values keyed by NutrientKey. */
export function fromRows(rows: { nutrientCode: string; per100: { toString(): string } }[]) {
  const values: NutrientValues = {};
  for (const r of rows) {
    const key = nutrientKeyOf(r.nutrientCode);
    if (key) values[key] = Number(r.per100.toString());
  }
  return values;
}

/** Values → FoodNutrient rows, rounded to the column's three decimals. */
export function toRows(values: NutrientValues): { nutrientCode: string; per100: string }[] {
  return NUTRIENT_KEYS.filter((k) => values[k] !== undefined).map((k) => ({
    nutrientCode: NUTRIENT_CODES[k],
    per100: values[k]!.toFixed(3),
  }));
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const ENERGY_TOLERANCE = 0.15;

export interface EnergyCheck {
  /** 4 kcal/g protein and available carbohydrate, 9 fat, 2 fibre. */
  expectedKcal: number;
  statedKcal: number;
  /** |stated − expected| / expected; 0 when the food is too low in energy to judge. */
  deviation: number;
  ok: boolean;
}

/**
 * Publish validation and the nightly data QA job (nutrition LLD §7): stated energy must be within
 * ±15% of the macro estimate. Foods under 5 kcal both ways (salt, tea leaves, water) always pass.
 */
export function energyCheck(values: NutrientValues): EnergyCheck {
  const expected =
    4 * (values.proteinG ?? 0) +
    4 * (values.carbsG ?? 0) +
    9 * (values.fatG ?? 0) +
    2 * (values.fibreG ?? 0);
  const stated = values.energyKcal ?? 0;
  if (expected < 5 && stated < 5) {
    return { expectedKcal: expected, statedKcal: stated, deviation: 0, ok: true };
  }
  const deviation = expected === 0 ? 1 : Math.abs(stated - expected) / expected;
  return {
    expectedKcal: round3(expected),
    statedKcal: stated,
    deviation: round3(deviation),
    ok: deviation <= ENERGY_TOLERANCE,
  };
}
