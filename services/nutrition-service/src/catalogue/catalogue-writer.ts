import type { AdminFoodPatch, AdminRecipePatch, FoodSource, HouseholdUnit } from '@aura/contracts';
import { compatibleDiets, type FoodFlag } from '@aura/domain/nutrition';
import type { Prisma, PrismaClient } from '../generated/prisma';
export { recipeDerived } from './composite';
import { fromRows, toRows, type NutrientValues } from './nutrients';
import type { FoodRecord, RecipeDerived, RecipeRecord } from './records';

/**
 * Plans and applies catalogue imports idempotently (TAC-14). Foods are matched on
 * (source, sourceRef) and recipes on slug. A record equal to what is stored is left alone, so a
 * second run changes nothing. Draft and in-review items are updated in place. Published curated
 * items are never changed underneath users: the new values wait as a pending revision for a
 * reviewer (admin LLD §2). Published reference data (FDC, IFCT) is updated in place with a new
 * version, because the source itself is the authority.
 */

export type ChangeKind = 'create' | 'update' | 'revise' | 'unchanged';

export interface PlannedChange {
  kind: ChangeKind;
  entity: 'food' | 'recipe';
  key: string;
  name: string;
  /** Fields that differ from what is stored (empty for create and unchanged). */
  fields: string[];
}

/** Links a composite dish to the recipe it is computed from. */
export interface CompositeLink {
  recipeSlug: string;
}

export interface ImportInput {
  foods: FoodRecord[];
  recipes?: RecipeRecord[];
  /** Composite dishes, applied after recipes so they can link to them. */
  composites?: { food: FoodRecord; link: CompositeLink }[];
  /** Status of new items: IN_REVIEW for curated content, PUBLISHED for reference sources. */
  newStatus: 'IN_REVIEW' | 'PUBLISHED';
}

export interface ImportPlan {
  changes: PlannedChange[];
  counts: Record<ChangeKind, number>;
}

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

const REFERENCE_SOURCES: FoodSource[] = ['IFCT_2017', 'USDA_FDC', 'OPEN_FOOD_FACTS'];

const foodInclude = {
  nutrients: true,
  units: true,
  rawEquivalent: { select: { sourceRef: true } },
} satisfies Prisma.FoodItemInclude;
type StoredFood = Prisma.FoodItemGetPayload<{ include: typeof foodInclude }>;

const recipeInclude = {
  ingredients: { include: { food: { select: { sourceRef: true } } }, orderBy: { order: 'asc' } },
} satisfies Prisma.RecipeInclude;
type StoredRecipe = Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>;

const num = (v: { toString(): string } | null) => (v === null ? null : Number(v.toString()));
const sorted = <T>(values: readonly T[]) => [...values].sort();
const unitsOf = (units: readonly HouseholdUnit[]) =>
  [...units]
    .map((u) => ({ code: u.code, label: u.label, grams: Math.round(u.grams * 100) / 100 }))
    .sort((a, b) => a.code.localeCompare(b.code));
const nutrientsOf = (values: NutrientValues) =>
  Object.fromEntries(
    Object.entries(values)
      .map(([k, v]) => [k, Math.round(v * 1000) / 1000] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** The fields an import compares, in a form both a record and a stored row reduce to. */
function foodSnapshot(r: FoodRecord) {
  return {
    slug: r.slug,
    name: r.name,
    localNames: r.localNames,
    confidence: r.confidence,
    state: r.state,
    category: r.category,
    cuisine: r.cuisine,
    flags: sorted(r.flags),
    allergens: sorted(r.allergens),
    densityGPerMl: r.densityGPerMl,
    yieldFactor: r.yieldFactor,
    rawEquivalentRef: r.rawEquivalentRef,
    nutrients: nutrientsOf(r.nutrients),
    units: unitsOf(r.units),
  };
}

function storedFoodRecord(row: StoredFood): FoodRecord {
  return {
    slug: row.slug,
    name: row.name,
    localNames: row.localNames,
    source: row.source,
    sourceRef: row.sourceRef ?? '',
    confidence: row.confidence,
    state: row.state,
    category: row.category,
    cuisine: row.cuisine,
    flags: row.flags as FoodFlag[],
    allergens: row.allergens,
    densityGPerMl: num(row.densityGPerMl),
    yieldFactor: num(row.yieldFactor),
    rawEquivalentRef: row.rawEquivalent?.sourceRef ?? null,
    nutrients: fromRows(row.nutrients),
    units: row.units.map((u) => ({ code: u.code, label: u.label, grams: Number(u.grams) })),
    reviewRequired: row.reviewRequired,
  };
}

function recipeSnapshot(r: RecipeRecord) {
  return {
    name: r.name,
    localNames: r.localNames,
    cuisine: r.cuisine,
    region: r.region,
    mealSlots: r.mealSlots,
    servings: r.servings,
    cookedYieldG: r.cookedYieldG,
    yieldMeasured: r.yieldMeasured,
    restaurantStyle: r.restaurantStyle,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    costTier: r.costTier,
    steps: r.steps,
    ingredients: r.ingredients,
    substitutions: r.substitutions,
    units: unitsOf(r.units),
    derived: r.derived ?? null,
  };
}

type StoredSubstitution = { ingredientFoodId: string; alternatives: string[]; note: string | null };

function storedRecipeRecord(row: StoredRecipe, refById: Map<string, string>): RecipeRecord {
  const ref = (id: string) => refById.get(id) ?? id;
  return {
    slug: row.slug,
    name: row.name,
    localNames: row.localNames,
    cuisine: row.cuisine,
    region: row.region,
    mealSlots: row.mealSlots,
    servings: row.servings,
    cookedYieldG: Number(row.cookedYieldG),
    yieldMeasured: row.yieldMeasured,
    restaurantStyle: row.restaurantStyle,
    prepMinutes: row.prepMinutes,
    cookMinutes: row.cookMinutes,
    costTier: row.costTier,
    steps: row.steps,
    ingredients: row.ingredients.map((i) => ({
      ref: i.food.sourceRef ?? i.foodId,
      grams: Number(i.grams),
      note: i.note,
    })),
    substitutions: (row.substitutions as StoredSubstitution[]).map((s) => ({
      ingredientRef: ref(s.ingredientFoodId),
      alternatives: s.alternatives.map(ref),
      note: s.note,
    })),
    units: row.units as HouseholdUnit[],
    reviewRequired: row.reviewRequired,
    derived: {
      dietTags: row.dietTags as RecipeDerived['dietTags'],
      allergens: row.allergens,
      flags: row.flags as FoodFlag[],
      fastingOk: row.fastingOk,
      oilG: Number(row.oilG),
    },
  };
}

function diff<T extends Record<string, unknown>>(a: T, b: T): string[] {
  return Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

const foodKey = (source: string, ref: string) => `${source}:${ref}`;

export class CatalogueWriter {
  constructor(private readonly db: Db) {}

  /** What an import would do. Reads only. */
  async plan(input: ImportInput): Promise<ImportPlan> {
    const state = await this.load(input);
    return this.compute(input, state).plan;
  }

  /** Applies the plan item by item; safe to re-run after a failure. */
  async apply(input: ImportInput): Promise<ImportPlan> {
    const state = await this.load(input);
    const { plan, foodChanges, recipeChanges, compositeChanges } = this.compute(input, state);
    const ids = state.idByKey;
    const now = new Date();

    for (const c of foodChanges) await this.writeFood(c, ids, input.newStatus, now);
    for (const c of recipeChanges) await this.writeRecipe(c, ids, input.newStatus);
    for (const c of compositeChanges) await this.writeFood(c, ids, input.newStatus, now);
    return plan;
  }

  private async load(input: ImportInput) {
    const records = [...input.foods, ...(input.composites ?? []).map((c) => c.food)];
    const sources = [...new Set(records.map((r) => r.source))];
    const foods = await this.db.foodItem.findMany({
      where: { source: { in: sources } },
      include: foodInclude,
    });
    const foodByKey = new Map(foods.map((f) => [foodKey(f.source, f.sourceRef ?? ''), f]));
    const idByKey = new Map(foods.map((f) => [foodKey(f.source, f.sourceRef ?? ''), f.id]));
    const recipes = input.recipes?.length
      ? await this.db.recipe.findMany({
          where: { slug: { in: input.recipes.map((r) => r.slug) } },
          include: recipeInclude,
        })
      : [];
    const refById = new Map(
      foods
        .filter((f) => f.source === 'CURATED_INGREDIENT')
        .map((f) => [f.id, f.sourceRef ?? f.id]),
    );
    return {
      foodByKey,
      idByKey,
      recipeBySlug: new Map(recipes.map((r) => [r.slug, r])),
      refById,
    };
  }

  private compute(input: ImportInput, state: Awaited<ReturnType<CatalogueWriter['load']>>) {
    const changes: PlannedChange[] = [];
    const planFood = (record: FoodRecord, link?: CompositeLink) => {
      const stored = state.foodByKey.get(foodKey(record.source, record.sourceRef));
      const change = { record, stored, link, ...this.classifyFood(record, stored) };
      changes.push({
        kind: change.kind,
        entity: 'food',
        key: foodKey(record.source, record.sourceRef),
        name: record.name,
        fields: change.fields,
      });
      return change;
    };
    const foodChanges = input.foods.map((r) => planFood(r));
    const recipeChanges = (input.recipes ?? []).map((record) => {
      const stored = state.recipeBySlug.get(record.slug);
      const change = { record, stored, ...this.classifyRecipe(record, stored, state.refById) };
      changes.push({
        kind: change.kind,
        entity: 'recipe',
        key: record.slug,
        name: record.name,
        fields: change.fields,
      });
      return change;
    });
    const compositeChanges = (input.composites ?? []).map((c) => planFood(c.food, c.link));
    const counts: Record<ChangeKind, number> = { create: 0, update: 0, revise: 0, unchanged: 0 };
    for (const c of changes) counts[c.kind] += 1;
    return { plan: { changes, counts }, foodChanges, recipeChanges, compositeChanges };
  }

  private classifyFood(record: FoodRecord, stored: StoredFood | undefined) {
    if (!stored) return { kind: 'create' as const, fields: [] };
    const fields = diff(foodSnapshot(record), foodSnapshot(storedFoodRecord(stored)));
    if (stored.status !== 'PUBLISHED' || REFERENCE_SOURCES.includes(record.source)) {
      return { kind: fields.length ? ('update' as const) : ('unchanged' as const), fields };
    }
    if (fields.length === 0) return { kind: 'unchanged' as const, fields };
    // Published curated food: compare with the revision already waiting, if any.
    const pending = stored.pendingRevision as AdminFoodPatch | null;
    const proposed = foodPatch(record, fields, null);
    if (pending && JSON.stringify(withoutIds(pending)) === JSON.stringify(withoutIds(proposed))) {
      return { kind: 'unchanged' as const, fields: [] };
    }
    return { kind: 'revise' as const, fields };
  }

  private classifyRecipe(
    record: RecipeRecord,
    stored: StoredRecipe | undefined,
    refById: Map<string, string>,
  ) {
    if (!stored) return { kind: 'create' as const, fields: [] };
    const fields = diff(
      recipeSnapshot(record),
      recipeSnapshot(storedRecipeRecord(stored, refById)),
    );
    if (fields.length === 0) return { kind: 'unchanged' as const, fields };
    if (stored.status !== 'PUBLISHED') return { kind: 'update' as const, fields };
    const pending = stored.pendingRevision as { importFields?: string[] } | null;
    if (pending && JSON.stringify(pending.importFields) === JSON.stringify(fields)) {
      return { kind: 'unchanged' as const, fields: [] };
    }
    return { kind: 'revise' as const, fields };
  }

  private async writeFood(
    c: {
      kind: ChangeKind;
      record: FoodRecord;
      stored: StoredFood | undefined;
      fields: string[];
      link?: CompositeLink;
    },
    ids: Map<string, string>,
    newStatus: ImportInput['newStatus'],
    now: Date,
  ) {
    const { record } = c;
    const key = foodKey(record.source, record.sourceRef);
    if (c.kind === 'unchanged') return;
    const rawEquivalentId = record.rawEquivalentRef
      ? (ids.get(foodKey(record.source, record.rawEquivalentRef)) ?? null)
      : null;
    const recipeId = c.link
      ? (await this.db.recipe.findUnique({ where: { slug: c.link.recipeSlug } }))?.id
      : undefined;

    if (c.kind === 'revise') {
      await this.db.foodItem.update({
        where: { id: c.stored!.id },
        data: {
          pendingRevision: foodPatch(record, c.fields, rawEquivalentId) as Prisma.InputJsonValue,
          revisionStatus: 'IN_REVIEW',
          reviewRequired: record.reviewRequired,
        },
      });
      return;
    }

    const scalars = {
      slug: record.slug,
      name: record.name,
      localNames: record.localNames,
      confidence: record.confidence,
      state: record.state,
      category: record.category,
      cuisine: record.cuisine,
      flags: record.flags,
      dietTags: compatibleDiets(record.flags),
      allergens: record.allergens,
      densityGPerMl: record.densityGPerMl,
      yieldFactor: record.yieldFactor,
      rawEquivalentId,
      reviewRequired: record.reviewRequired,
      ...(recipeId ? { recipeId } : {}),
    };
    await this.db.$transaction(async (tx: Tx) => {
      if (c.kind === 'create') {
        const created = await tx.foodItem.create({
          data: {
            ...scalars,
            source: record.source,
            sourceRef: record.sourceRef,
            status: newStatus,
            ...(newStatus === 'PUBLISHED' ? { publishedAt: now } : {}),
            nutrients: { create: toRows(record.nutrients) },
            units: { create: record.units },
          },
        });
        ids.set(key, created.id);
        return;
      }
      const id = c.stored!.id;
      await tx.foodNutrient.deleteMany({ where: { foodId: id } });
      await tx.foodUnit.deleteMany({ where: { foodId: id } });
      await tx.foodItem.update({
        where: { id },
        data: {
          ...scalars,
          ...(c.stored!.status === 'PUBLISHED' ? { version: { increment: 1 } } : {}),
          nutrients: { create: toRows(record.nutrients) },
          units: { create: record.units },
        },
      });
    });
  }

  private async writeRecipe(
    c: {
      kind: ChangeKind;
      record: RecipeRecord;
      stored: StoredRecipe | undefined;
      fields: string[];
    },
    ids: Map<string, string>,
    newStatus: ImportInput['newStatus'],
  ) {
    if (c.kind === 'unchanged') return;
    const { record } = c;
    const idOf = (ref: string) => {
      const id = ids.get(foodKey('CURATED_INGREDIENT', ref));
      if (!id) throw new Error(`Recipe ${record.slug}: ingredient ${ref} is not in the catalogue`);
      return id;
    };
    const ingredients = record.ingredients.map((i, order) => ({
      foodId: idOf(i.ref),
      grams: i.grams,
      note: i.note,
      order,
    }));
    const substitutions = record.substitutions.map((s) => ({
      ingredientFoodId: idOf(s.ingredientRef),
      alternatives: s.alternatives.map(idOf),
      note: s.note,
    }));

    if (c.kind === 'revise') {
      const patch: AdminRecipePatch & { importFields: string[] } = {
        ...recipePatch(record, ingredients, substitutions),
        importFields: c.fields,
      };
      await this.db.recipe.update({
        where: { id: c.stored!.id },
        data: {
          pendingRevision: patch as Prisma.InputJsonValue,
          revisionStatus: 'IN_REVIEW',
          reviewRequired: record.reviewRequired,
        },
      });
      return;
    }

    const data = {
      name: record.name,
      localNames: record.localNames,
      cuisine: record.cuisine,
      region: record.region,
      mealSlots: record.mealSlots,
      servings: record.servings,
      cookedYieldG: record.cookedYieldG,
      yieldMeasured: record.yieldMeasured,
      restaurantStyle: record.restaurantStyle,
      prepMinutes: record.prepMinutes,
      cookMinutes: record.cookMinutes,
      costTier: record.costTier,
      steps: record.steps,
      substitutions: substitutions as Prisma.InputJsonValue,
      units: record.units as unknown as Prisma.InputJsonValue,
      reviewRequired: record.reviewRequired,
      ...(record.derived ?? {}),
    };
    await this.db.$transaction(async (tx: Tx) => {
      if (c.kind === 'create') {
        await tx.recipe.create({
          data: {
            ...data,
            slug: record.slug,
            status: newStatus,
            ingredients: { create: ingredients },
          },
        });
        return;
      }
      await tx.recipeIngredient.deleteMany({ where: { recipeId: c.stored!.id } });
      await tx.recipe.update({
        where: { id: c.stored!.id },
        data: { ...data, ingredients: { create: ingredients } },
      });
    });
  }
}

function withoutIds(patch: AdminFoodPatch) {
  const { rawEquivalentId: _ignored, ...rest } = patch;
  return rest;
}

/** A pending revision in the admin PATCH shape: the changed fields of a published food. */
function foodPatch(record: FoodRecord, fields: string[], rawEquivalentId: string | null) {
  const patch: AdminFoodPatch = {};
  const has = (f: string) => fields.includes(f);
  if (has('name')) patch.name = record.name;
  if (has('localNames')) patch.localNames = record.localNames;
  if (has('confidence')) patch.confidence = record.confidence;
  if (has('state')) patch.state = record.state;
  if (has('category')) patch.category = record.category;
  if (has('cuisine')) patch.cuisine = record.cuisine;
  if (has('flags')) patch.flags = record.flags;
  if (has('allergens')) patch.allergens = record.allergens as AdminFoodPatch['allergens'];
  if (has('densityGPerMl')) patch.densityGPerMl = record.densityGPerMl;
  if (has('yieldFactor')) patch.yieldFactor = record.yieldFactor;
  if (has('rawEquivalentRef')) patch.rawEquivalentId = rawEquivalentId;
  if (has('nutrients')) patch.nutrients = record.nutrients as AdminFoodPatch['nutrients'];
  if (has('units')) patch.units = record.units;
  return patch;
}

function recipePatch(
  record: RecipeRecord,
  ingredients: { foodId: string; grams: number; note: string | null }[],
  substitutions: StoredSubstitution[],
): AdminRecipePatch {
  return {
    name: record.name,
    localNames: record.localNames,
    cuisine: record.cuisine,
    region: record.region as AdminRecipePatch['region'],
    mealSlots: record.mealSlots as AdminRecipePatch['mealSlots'],
    servings: record.servings,
    cookedYieldG: record.cookedYieldG,
    yieldMeasured: record.yieldMeasured,
    restaurantStyle: record.restaurantStyle,
    prepMinutes: record.prepMinutes,
    cookMinutes: record.cookMinutes,
    costTier: record.costTier,
    steps: record.steps,
    ingredients: ingredients.map(({ foodId, grams, note }) => ({ foodId, grams, note })),
    substitutions,
    units: record.units,
  };
}

/** Prints a plan the way `--dry-run` shows it. */
export function formatPlan(plan: ImportPlan, verbose = false): string {
  const lines: string[] = [];
  const mark: Record<ChangeKind, string> = {
    create: '+',
    update: '~',
    revise: '?',
    unchanged: '=',
  };
  for (const c of plan.changes) {
    if (c.kind === 'unchanged' && !verbose) continue;
    const fields = c.fields.length ? ` (${c.fields.join(', ')})` : '';
    lines.push(`${mark[c.kind]} ${c.entity} ${c.key} ${c.name}${fields}`);
  }
  const { create, update, revise, unchanged } = plan.counts;
  lines.push(
    `${create} to create, ${update} to update, ${revise} to revise (published: waits for review), ${unchanged} unchanged`,
  );
  return lines.join('\n');
}
