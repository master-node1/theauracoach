import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HouseholdUnit } from '@aura/contracts';
import type { NutrientValues } from '../catalogue/nutrients';
import type { FoodRecord } from '../catalogue/records';
import { classify, stateOf } from './classify';
import { cellNumber, parseCsv } from './csv';

/**
 * USDA FoodData Central importer (Foundation Foods and SR Legacy, public domain). Reads either the
 * CSV download (food.csv, food_nutrient.csv, optional food_category.csv and food_portion.csv) or
 * the JSON download (FoundationFoods / SRLegacyFoods). Other data types (branded, survey) are
 * skipped: branded foods come from Open Food Facts later.
 */

const DATA_TYPES = new Set(['foundation_food', 'sr_legacy_food', 'Foundation', 'SR Legacy']);

/** FDC nutrient ids. Energy: 1008 (kcal), else the Atwater factors 2047/2048. */
const N = {
  energy: [1008, 2047, 2048],
  protein: 1003,
  fat: 1004,
  carbByDifference: 1005,
  fibre: 1079,
  sugar: [2000, 1063],
  sodium: 1093,
  iron: 1089,
  calcium: 1087,
  b12: 1178,
  vitaminD: 1114,
};

/** FDC food categories → our grocery aisle and the classifier group. */
const CATEGORIES: [RegExp, string][] = [
  [/dairy and egg/i, 'dairy'],
  [/spices and herbs/i, 'spice'],
  [/fats and oils/i, 'fat'],
  [/poultry/i, 'poultry'],
  [/sausages|pork|beef|lamb|veal|game/i, 'meat'],
  [/finfish and shellfish/i, 'fish'],
  [/fruit/i, 'fruit'],
  [/vegetable/i, 'vegetable'],
  [/nut and seed/i, 'nut'],
  [/legume/i, 'pulse'],
  [/cereal grains|breakfast cereals/i, 'cereal'],
  [/baked/i, 'bakery'],
  [/sweets/i, 'sweetener'],
  [/beverages/i, 'beverage'],
  [/snacks/i, 'snack'],
  [/soups|sauces|gravies/i, 'condiment'],
];

export interface FdcFood {
  fdcId: string;
  dataType: string;
  description: string;
  category: string;
  nutrients: Map<number, number>;
  portions: { label: string; grams: number }[];
}

export interface FdcResult {
  records: FoodRecord[];
  skipped: { ref: string; reason: string }[];
}

export function readFdcDirectory(dir: string): FdcFood[] {
  const json = ['FoodData_Central_foundation_food_json.json', 'foundation.json', 'sr_legacy.json']
    .map((f) => join(dir, f))
    .filter(existsSync);
  if (json.length > 0) return json.flatMap((f) => fromJson(JSON.parse(readFileSync(f, 'utf8'))));
  return fromCsv(dir);
}

function fromCsv(dir: string): FdcFood[] {
  const read = (f: string) => (existsSync(join(dir, f)) ? parseCsv(readFileSync(join(dir, f), 'utf8')) : []);
  const categories = new Map(read('food_category.csv').map((c) => [c.id!, c.description!]));
  const foods = new Map<string, FdcFood>();
  for (const row of read('food.csv')) {
    if (!DATA_TYPES.has(row.data_type!)) continue;
    foods.set(row.fdc_id!, {
      fdcId: row.fdc_id!,
      dataType: row.data_type!,
      description: row.description!,
      category: categories.get(row.food_category_id!) ?? row.food_category_id ?? '',
      nutrients: new Map(),
      portions: [],
    });
  }
  for (const row of read('food_nutrient.csv')) {
    const food = foods.get(row.fdc_id!);
    const amount = cellNumber(row.amount);
    if (food && amount !== undefined) food.nutrients.set(Number(row.nutrient_id), amount);
  }
  for (const row of read('food_portion.csv')) {
    const food = foods.get(row.fdc_id!);
    const grams = cellNumber(row.gram_weight);
    const amount = cellNumber(row.amount) ?? 1;
    const label = [row.portion_description, row.modifier].find((v) => v && v !== 'undetermined');
    if (food && grams && label) food.portions.push({ label, grams: grams / amount });
  }
  return [...foods.values()];
}

interface FdcJsonFood {
  fdcId: number;
  dataType: string;
  description: string;
  foodCategory?: { description?: string };
  foodNutrients?: { nutrient?: { id?: number }; amount?: number }[];
  foodPortions?: {
    gramWeight?: number;
    amount?: number;
    modifier?: string;
    portionDescription?: string;
  }[];
}

function fromJson(doc: { FoundationFoods?: FdcJsonFood[]; SRLegacyFoods?: FdcJsonFood[] }) {
  return [...(doc.FoundationFoods ?? []), ...(doc.SRLegacyFoods ?? [])]
    .filter((f) => DATA_TYPES.has(f.dataType))
    .map(
      (f): FdcFood => ({
        fdcId: String(f.fdcId),
        dataType: f.dataType,
        description: f.description,
        category: f.foodCategory?.description ?? '',
        nutrients: new Map(
          (f.foodNutrients ?? [])
            .filter((n) => n.nutrient?.id !== undefined && n.amount !== undefined)
            .map((n) => [n.nutrient!.id!, n.amount!]),
        ),
        portions: (f.foodPortions ?? [])
          .filter((p) => p.gramWeight && (p.portionDescription || p.modifier))
          .map((p) => ({
            label: (p.portionDescription && p.portionDescription !== 'Quantity not specified'
              ? p.portionDescription
              : p.modifier)!,
            grams: p.gramWeight! / (p.amount || 1),
          })),
      }),
    );
}

const first = (m: Map<number, number>, ids: number[]) =>
  ids.map((id) => m.get(id)).find((v) => v !== undefined);

function unitCode(label: string): string {
  const code = label
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20)
    .replace(/_+$/, '');
  return /^[a-z]/.test(code) ? code : `u_${code}`.slice(0, 20);
}

export function fdcRecords(foods: FdcFood[]): FdcResult {
  const records: FoodRecord[] = [];
  const skipped: FdcResult['skipped'] = [];
  for (const f of foods) {
    const m = f.nutrients;
    const energy = first(m, N.energy);
    const protein = m.get(N.protein);
    const fat = m.get(N.fat);
    const fibre = m.get(N.fibre) ?? 0;
    const carbs = m.get(N.carbByDifference);
    if ([energy, protein, fat, carbs].some((v) => v === undefined)) {
      skipped.push({ ref: f.fdcId, reason: 'missing energy or macronutrients' });
      continue;
    }
    const nutrients: NutrientValues = {
      energyKcal: energy!,
      proteinG: protein!,
      // We store available carbohydrate: FDC's "by difference" includes fibre.
      carbsG: Math.max(0, Math.round((carbs! - fibre) * 1000) / 1000),
      fatG: fat!,
      fibreG: fibre,
    };
    const optional: [keyof NutrientValues, number | undefined][] = [
      ['sugarG', first(m, N.sugar)],
      ['sodiumMg', m.get(N.sodium)],
      ['ironMg', m.get(N.iron)],
      ['calciumMg', m.get(N.calcium)],
      ['vitaminB12Ug', m.get(N.b12)],
      ['vitaminDUg', m.get(N.vitaminD)],
    ];
    for (const [k, v] of optional) if (v !== undefined) nutrients[k] = v;

    const group = CATEGORIES.find(([re]) => re.test(f.category))?.[1] ?? 'other';
    const cls = classify(group, f.description);
    const units: HouseholdUnit[] = [];
    for (const p of f.portions) {
      const code = unitCode(p.label);
      if (!code || units.some((u) => u.code === code) || units.length >= 6) continue;
      units.push({ code, label: p.label.slice(0, 40), grams: Math.round(p.grams * 100) / 100 });
    }
    records.push({
      slug: null,
      name: f.description.slice(0, 120),
      localNames: [],
      source: 'USDA_FDC',
      sourceRef: f.fdcId,
      confidence: 'HIGH',
      state: stateOf(f.description, 'AS_SOLD'),
      category: cls.category === 'poultry' ? 'meat' : cls.category,
      cuisine: null,
      flags: cls.flags,
      allergens: cls.allergens,
      densityGPerMl: null,
      yieldFactor: null,
      rawEquivalentRef: null,
      nutrients,
      units,
      reviewRequired: null,
    });
  }
  return { records, skipped };
}
