import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ALLERGENS, FOOD_FLAGS, MEAL_SLOTS, REGIONS, type HouseholdUnit } from '@aura/contracts';
import { z } from 'zod';
import { buildComposite, type CompositeResult } from './composite';
import type { NutrientValues } from './nutrients';
import type { FoodRecord, RecipeRecord } from './records';

/**
 * Curated content under content/nutrition (TAC-14): ingredients, household units, cooked forms
 * and composite Indian recipes, kept compact for hand editing. Validated with Zod in CI
 * (test/content.test.ts) and turned into catalogue records here. Everything imports as IN_REVIEW
 * with reviewRequired "nutrition" until a nutritionist signs it off.
 */

export const DEFAULT_CONTENT_DIR = resolve(__dirname, '../../content/nutrition');

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lower-kebab-case slug');
const code = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/, 'lower_snake_case code');
const name = z.string().trim().min(2).max(120);
const localNames = z.array(z.string().trim().min(1).max(60)).max(12).default([]);
const unitPair = z.tuple([code, z.number().positive().max(5000)]);

const ingredientSchema = z.strictObject({
  slug,
  name,
  local: localNames,
  cat: code,
  state: z.enum(['RAW', 'AS_SOLD']).default('RAW'),
  flags: z.array(z.enum(FOOD_FLAGS)).default([]),
  allergens: z.array(z.enum(ALLERGENS)).default([]),
  density: z.number().positive().max(3).optional(),
  /** [energyKcal, proteinG, availableCarbsG, fatG, fibreG, sodiumMg?, ironMg?, calciumMg?] */
  n: z
    .array(z.number().min(0).max(40000))
    .min(5)
    .max(8)
    .refine((n) => n.slice(0, 5).every((v) => v <= 900), 'macros are per 100 g'),
  units: z.array(unitPair).max(10).default([]),
});

const unitsFileSchema = z.object({
  units: z.array(
    z.strictObject({
      code,
      label: z.string().min(1).max(40),
      grams: z.number().positive().optional(),
      ml: z.number().positive().optional(),
    }),
  ),
  liquidUnits: z.array(code),
});

const cookedSchema = z.strictObject({
  raw: slug,
  slug,
  name,
  local: localNames,
  yieldFactor: z.number().positive().max(9.999),
  units: z.array(unitPair).max(10).default([]),
});

const recipeSchema = z.strictObject({
  slug,
  name,
  local: localNames,
  region: z.enum(REGIONS).optional(),
  cuisine: code,
  slots: z.array(z.enum(MEAL_SLOTS)).min(1).max(4),
  serves: z.number().int().min(1).max(50),
  yield: z.number().positive().max(50000),
  prep: z.number().int().min(0).max(1440),
  cook: z.number().int().min(0).max(1440),
  cost: z.number().int().min(1).max(3),
  restaurant: z.boolean().default(false),
  ing: z.array(z.tuple([slug, z.number().positive().max(10000)])).min(1).max(40),
  steps: z.array(z.string().trim().min(3).max(400)).min(1).max(20),
  subs: z
    .array(z.tuple([slug, z.array(slug).min(1).max(5), z.string().trim().max(120)]))
    .max(20)
    .default([]),
  units: z.array(unitPair).max(8).optional(),
});

const recipeFileSchema = z.strictObject({
  region: z.enum(REGIONS),
  recipes: z.array(recipeSchema),
});

export type IngredientContent = z.infer<typeof ingredientSchema>;
export type RecipeContent = z.infer<typeof recipeSchema> & { region: (typeof REGIONS)[number] };

export interface CuratedContent {
  ingredients: IngredientContent[];
  cooked: z.infer<typeof cookedSchema>[];
  recipes: RecipeContent[];
  unitLabels: Map<string, string>;
  liquidUnits: { code: string; ml: number }[];
}

export class ContentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Curated content is invalid:\n- ${problems.join('\n- ')}`);
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string, problems: string[]) {
  const result = schema.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push(`${where} ${issue.path.join('.')}: ${issue.message}`);
    }
    return undefined;
  }
  return result.data;
}

/** Reads and validates every content file, including cross-references. Throws ContentError. */
export function loadCuratedContent(dir = DEFAULT_CONTENT_DIR): CuratedContent {
  const problems: string[] = [];
  const ingredients =
    parse(
      z.object({ ingredients: z.array(ingredientSchema) }),
      readJson(join(dir, 'ingredients.json')),
      'ingredients.json',
      problems,
    )?.ingredients ?? [];
  const unitsFile = parse(unitsFileSchema, readJson(join(dir, 'units.json')), 'units.json', problems);
  const cooked =
    parse(
      z.object({ cooked: z.array(cookedSchema) }),
      readJson(join(dir, 'yield-factors.json')),
      'yield-factors.json',
      problems,
    )?.cooked ?? [];
  const recipes: RecipeContent[] = [];
  const recipeDir = join(dir, 'recipes');
  for (const file of readdirSync(recipeDir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = parse(recipeFileSchema, readJson(join(recipeDir, file)), file, problems);
    for (const r of parsed?.recipes ?? []) recipes.push({ ...r, region: r.region ?? parsed!.region });
  }

  const unitLabels = new Map((unitsFile?.units ?? []).map((u) => [u.code, u.label]));
  const liquidUnits = (unitsFile?.liquidUnits ?? []).map((c) => {
    const ml = unitsFile?.units.find((u) => u.code === c)?.ml;
    if (!ml) problems.push(`units.json: liquid unit ${c} has no ml`);
    return { code: c, ml: ml ?? 0 };
  });

  const slugs = new Set<string>();
  const unique = (s: string, where: string) => {
    if (slugs.has(s)) problems.push(`${where}: slug ${s} is used twice`);
    slugs.add(s);
  };
  const ingredientSlugs = new Set(ingredients.map((i) => i.slug));
  const checkUnits = (units: [string, number][] | undefined, where: string) => {
    for (const [c] of units ?? []) {
      if (!unitLabels.has(c)) problems.push(`${where}: unknown unit ${c}`);
    }
  };
  for (const i of ingredients) {
    unique(i.slug, 'ingredients.json');
    checkUnits(i.units, `ingredient ${i.slug}`);
  }
  for (const c of cooked) {
    unique(c.slug, 'yield-factors.json');
    if (!ingredientSlugs.has(c.raw)) problems.push(`cooked ${c.slug}: unknown raw ${c.raw}`);
    checkUnits(c.units, `cooked ${c.slug}`);
  }
  for (const r of recipes) {
    unique(r.slug, 'recipes');
    checkUnits(r.units, `recipe ${r.slug}`);
    for (const [s] of r.ing) {
      if (!ingredientSlugs.has(s)) problems.push(`recipe ${r.slug}: unknown ingredient ${s}`);
    }
    for (const [s, alts] of r.subs) {
      if (!r.ing.some(([i]) => i === s)) {
        problems.push(`recipe ${r.slug}: substitution for ${s}, which is not an ingredient`);
      }
      for (const a of alts) {
        if (!ingredientSlugs.has(a)) problems.push(`recipe ${r.slug}: unknown substitute ${a}`);
      }
    }
  }
  if (problems.length > 0) throw new ContentError(problems);
  return { ingredients, cooked, recipes, unitLabels, liquidUnits };
}

function ingredientNutrients(n: number[]): NutrientValues {
  const [energyKcal, proteinG, carbsG, fatG, fibreG, sodiumMg, ironMg, calciumMg] = n;
  const values: NutrientValues = {
    energyKcal: energyKcal!,
    proteinG: proteinG!,
    carbsG: carbsG!,
    fatG: fatG!,
    fibreG: fibreG!,
  };
  if (sodiumMg !== undefined) values.sodiumMg = sodiumMg;
  if (ironMg !== undefined) values.ironMg = ironMg;
  if (calciumMg !== undefined) values.calciumMg = calciumMg;
  return values;
}

export interface CuratedRecords {
  foods: FoodRecord[];
  recipes: RecipeRecord[];
  /** The composite dish of each recipe, computed from the curated ingredient values. */
  composites: Map<string, { food: FoodRecord; composite: CompositeResult }>;
}

const sortUnique = <T extends string>(values: Iterable<T>) => [...new Set(values)].sort();

/** Curated content → catalogue records (source CURATED_INGREDIENT / CURATED_RECIPE). */
export function curatedRecords(content: CuratedContent): CuratedRecords {
  const unit = (c: string, grams: number): HouseholdUnit => ({
    code: c,
    label: content.unitLabels.get(c) ?? c,
    grams: Math.round(grams * 100) / 100,
  });
  const pending = 'nutrition';
  const foods: FoodRecord[] = [];
  const bySlug = new Map<string, FoodRecord>();

  for (const i of content.ingredients) {
    const units = i.units.map(([c, g]) => unit(c, g));
    if (i.density) {
      for (const l of content.liquidUnits) {
        if (!units.some((u) => u.code === l.code)) units.push(unit(l.code, l.ml * i.density));
      }
    }
    const record: FoodRecord = {
      slug: i.slug,
      name: i.name,
      localNames: i.local,
      source: 'CURATED_INGREDIENT',
      sourceRef: i.slug,
      confidence: 'MEDIUM',
      state: i.state,
      category: i.cat,
      cuisine: null,
      flags: sortUnique(i.flags),
      allergens: sortUnique(i.allergens),
      densityGPerMl: i.density ?? null,
      yieldFactor: null,
      rawEquivalentRef: null,
      nutrients: ingredientNutrients(i.n),
      units,
      reviewRequired: pending,
    };
    foods.push(record);
    bySlug.set(i.slug, record);
  }

  for (const c of content.cooked) {
    const raw = bySlug.get(c.raw)!;
    const nutrients: NutrientValues = {};
    for (const [k, v] of Object.entries(raw.nutrients)) {
      nutrients[k as keyof NutrientValues] = Math.round((v / c.yieldFactor) * 1000) / 1000;
    }
    foods.push({
      ...raw,
      slug: c.slug,
      name: c.name,
      localNames: c.local,
      sourceRef: c.slug,
      state: 'COOKED',
      densityGPerMl: null,
      yieldFactor: c.yieldFactor,
      rawEquivalentRef: raw.sourceRef,
      nutrients,
      units: c.units.map(([u, g]) => unit(u, g)),
    });
  }

  const recipes: RecipeRecord[] = [];
  const composites = new Map<string, { food: FoodRecord; composite: CompositeResult }>();
  for (const r of content.recipes) {
    const units = (r.units ?? [['katori', 150]]).map(([c, g]) => unit(c, g));
    const record: RecipeRecord = {
      slug: r.slug,
      name: r.name,
      localNames: r.local,
      cuisine: r.cuisine,
      region: r.region,
      mealSlots: r.slots,
      servings: r.serves,
      cookedYieldG: r.yield,
      yieldMeasured: false,
      restaurantStyle: r.restaurant,
      prepMinutes: r.prep,
      cookMinutes: r.cook,
      costTier: r.cost,
      steps: r.steps,
      ingredients: r.ing.map(([ref, grams]) => ({ ref, grams, note: null })),
      substitutions: r.subs.map(([ingredientRef, alternatives, note]) => ({
        ingredientRef,
        alternatives,
        note: note || null,
      })),
      units,
      reviewRequired: pending,
    };
    recipes.push(record);
    const composite = buildComposite({
      ingredients: r.ing.map(([ref, grams]) => {
        const f = bySlug.get(ref)!;
        return { id: ref, grams, ...f };
      }),
      cookedYieldG: r.yield,
      yieldMeasured: false,
      restaurantStyle: r.restaurant,
    });
    composites.set(r.slug, { composite, food: compositeFoodRecord(record, composite) });
  }
  return { foods, recipes, composites };
}

/** The FoodItem a recipe publishes as (source CURATED_RECIPE, sourceRef = recipe slug). */
export function compositeFoodRecord(
  recipe: Pick<
    RecipeRecord,
    'slug' | 'name' | 'localNames' | 'cuisine' | 'units' | 'reviewRequired'
  >,
  composite: CompositeResult,
): FoodRecord {
  return {
    slug: recipe.slug,
    name: recipe.name,
    localNames: recipe.localNames,
    source: 'CURATED_RECIPE',
    sourceRef: recipe.slug,
    confidence: composite.confidence,
    state: 'COOKED',
    category: 'dish',
    cuisine: recipe.cuisine,
    flags: composite.flags,
    allergens: composite.allergens,
    densityGPerMl: null,
    yieldFactor: null,
    rawEquivalentRef: null,
    nutrients: composite.nutrients,
    units: recipe.units,
    reviewRequired: recipe.reviewRequired,
  };
}
