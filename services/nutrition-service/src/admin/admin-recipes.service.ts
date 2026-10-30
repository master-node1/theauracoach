import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AdminContentListQuery,
  AdminPage,
  AdminRecipe,
  AdminRecipeInput,
  AdminRecipePatch,
  ContentAction,
  HouseholdUnit,
} from '@aura/contracts';
import { compatibleDiets } from '@aura/domain/nutrition';
import { ProblemException, type AuthenticatedUser } from '@aura/service-kit';
import { Prisma } from '../generated/prisma';
import { buildComposite, recipeDerived, type CompositeResult } from '../catalogue/composite';
import { energyCheck, fromRows, toRows } from '../catalogue/nutrients';
import { PrismaService } from '../prisma.service';
import { FoodSearchService } from '../search/food-search.service';
import {
  audit,
  contentPublished,
  editTarget,
  stateOf,
  workflowState,
  workflowStep,
} from './content-workflow';

type Tx = Prisma.TransactionClient;

const recipeInclude = {
  ingredients: { include: { food: { select: { name: true } } }, orderBy: { order: 'asc' } },
  food: { select: { id: true } },
} satisfies Prisma.RecipeInclude;
type RecipeRow = Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>;

type Substitution = { ingredientFoodId: string; alternatives: string[]; note: string | null };
type Revision = AdminRecipePatch & { importFields?: string[] };

/** The recipe as it would be published: live values with any pending revision on top. */
interface EffectiveRecipe {
  name: string;
  localNames: string[];
  cuisine: string | null;
  cookedYieldG: number;
  yieldMeasured: boolean;
  restaurantStyle: boolean;
  ingredients: { foodId: string; grams: number; note: string | null }[];
  substitutions: Substitution[];
  units: HouseholdUnit[];
  steps: string[];
}

/** Admin recipes (admin LLD §2, nutrition LLD §4, §7). Publishing regenerates the composite dish. */
@Injectable()
export class AdminRecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: FoodSearchService,
  ) {}

  async list(query: AdminContentListQuery): Promise<AdminPage<AdminRecipe>> {
    const rows = await this.prisma.recipe.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      include: recipeInclude,
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminRecipe),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  async get(id: string): Promise<AdminRecipe> {
    return toAdminRecipe(await this.load(this.prisma, id));
  }

  async create(actor: AuthenticatedUser, input: AdminRecipeInput, requestId?: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      if (await tx.recipe.findUnique({ where: { slug: input.slug }, select: { id: true } })) {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'SLUG_TAKEN',
          'A recipe already uses this slug',
        );
      }
      await checkIngredients(tx, input.ingredients, input.substitutions);
      const { ingredients, ...rest } = input;
      const created = await tx.recipe.create({
        data: {
          ...rest,
          substitutions: input.substitutions as Prisma.InputJsonValue,
          units: input.units as unknown as Prisma.InputJsonValue,
          status: 'DRAFT',
          ingredients: { create: ingredients.map((i, order) => ({ ...i, order })) },
        },
      });
      await audit(tx, {
        actor,
        permission: 'recipe:write',
        action: 'recipe.create',
        entityType: 'recipe',
        entityId: created.id,
        before: null,
        after: { slug: input.slug, name: input.name, status: 'DRAFT' },
        requestId,
      });
      return created.id;
    });
    return this.get(id);
  }

  async patch(actor: AuthenticatedUser, id: string, patch: AdminRecipePatch, requestId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.load(tx, id, true);
      if (patch.ingredients || patch.substitutions) {
        await checkIngredients(
          tx,
          patch.ingredients ?? effective(row).ingredients,
          patch.substitutions ?? effective(row).substitutions,
        );
      }
      if (editTarget(row) === 'item') {
        await applyPatch(tx, id, patch);
      } else {
        const { importFields: _ignored, ...pending } =
          (row.pendingRevision as Revision | null) ?? {};
        await tx.recipe.update({
          where: { id },
          data: {
            pendingRevision: { ...pending, ...patch } as Prisma.InputJsonValue,
            revisionStatus: 'DRAFT',
          },
        });
      }
      await audit(tx, {
        actor,
        permission: 'recipe:write',
        action: 'recipe.update',
        entityType: 'recipe',
        entityId: id,
        before: stateOf(row),
        after: { ...stateOf(row), changed: Object.keys(patch) },
        requestId,
      });
    });
    return this.get(id);
  }

  async transition(
    actor: AuthenticatedUser,
    id: string,
    action: ContentAction,
    requestId?: string,
    note?: string,
  ): Promise<AdminRecipe> {
    let changedCatalogue = false;
    await this.prisma.$transaction(
      async (tx) => {
        const row = await this.load(tx, id, true);
        const step = workflowStep(row, action);
        const permission =
          action === 'submit'
            ? 'recipe:write'
            : action === 'reject'
              ? 'recipe:review'
              : 'recipe:publish';

        if (action === 'publish') {
          await this.publish(tx, actor, row, step.target === 'revision');
          changedCatalogue = true;
        } else if (action === 'archive') {
          await tx.recipe.update({
            where: { id },
            data: { status: 'ARCHIVED', pendingRevision: Prisma.DbNull, revisionStatus: null },
          });
          await tx.foodItem.updateMany({ where: { recipeId: id }, data: { status: 'ARCHIVED' } });
          changedCatalogue = true;
        } else if (step.target === 'revision') {
          await tx.recipe.update({ where: { id }, data: { revisionStatus: step.to } });
        } else {
          await tx.recipe.update({ where: { id }, data: { status: step.to } });
        }
        const after = await this.load(tx, id);
        await audit(tx, {
          actor,
          permission,
          action: `recipe.${action}`,
          entityType: 'recipe',
          entityId: id,
          before: stateOf(row),
          after: { ...stateOf(after), ...(note ? { note } : {}) },
          requestId,
        });
      },
      { timeout: 15_000 },
    );
    if (changedCatalogue) await this.search.invalidate();
    return this.get(id);
  }

  /**
   * Publish rules (nutrition LLD §7): every ingredient published, yield set, allergens and diets
   * derived from the ingredients, and the regenerated dish within ±15% energy. The composite
   * FoodItem is (re)written in the same transaction, so users never see a recipe without its dish.
   */
  private async publish(tx: Tx, actor: AuthenticatedUser, row: RecipeRow, revision: boolean) {
    const recipe = revision ? effective(row) : effective({ ...row, pendingRevision: null });
    const foods = await tx.foodItem.findMany({
      where: { id: { in: recipe.ingredients.map((i) => i.foodId) } },
      include: { nutrients: true },
    });
    const byId = new Map(foods.map((f) => [f.id, f]));
    const unpublished = recipe.ingredients
      .map((i) => byId.get(i.foodId))
      .filter((f) => !f || f.status !== 'PUBLISHED')
      .map((f) => f?.name ?? 'a deleted food');
    if (unpublished.length > 0) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'INGREDIENT_NOT_PUBLISHED',
        `Publish these ingredients first: ${[...new Set(unpublished)].join(', ')}`,
      );
    }
    if (!(recipe.cookedYieldG > 0)) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'YIELD_REQUIRED',
        'Set the cooked yield',
      );
    }
    const composite: CompositeResult = buildComposite({
      ingredients: recipe.ingredients.map((i) => {
        const f = byId.get(i.foodId)!;
        return {
          id: f.id,
          grams: i.grams,
          nutrients: fromRows(f.nutrients),
          confidence: f.confidence,
          allergens: f.allergens,
          flags: f.flags,
        };
      }),
      cookedYieldG: recipe.cookedYieldG,
      yieldMeasured: recipe.yieldMeasured,
      restaurantStyle: recipe.restaurantStyle,
    });
    const check = energyCheck(composite.nutrients);
    if (!check.ok) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ENERGY_MISMATCH',
        `Cannot publish: the dish's energy is ${Math.round(check.deviation * 100)}% off its macros (limit 15%)`,
      );
    }

    if (revision) await applyPatch(tx, row.id, row.pendingRevision as Revision);
    const version = row.publishedAt ? row.version + 1 : row.version;
    const now = new Date();
    await tx.recipe.update({
      where: { id: row.id },
      data: {
        ...recipeDerived(composite),
        status: 'PUBLISHED',
        version,
        pendingRevision: Prisma.DbNull,
        revisionStatus: null,
        reviewRequired: null,
        publishedAt: now,
        publishedById: actor.userId,
      },
    });

    const existing = await tx.foodItem.findFirst({
      where: { OR: [{ recipeId: row.id }, { source: 'CURATED_RECIPE', sourceRef: row.slug }] },
    });
    const slugOwner = await tx.foodItem.findUnique({
      where: { slug: row.slug },
      select: { id: true },
    });
    const foodData = {
      slug: !slugOwner || slugOwner.id === existing?.id ? row.slug : null,
      name: recipe.name,
      localNames: recipe.localNames,
      confidence: composite.confidence,
      state: 'COOKED' as const,
      category: 'dish',
      cuisine: recipe.cuisine,
      flags: composite.flags,
      dietTags: compatibleDiets(composite.flags),
      allergens: composite.allergens,
      recipeId: row.id,
      status: 'PUBLISHED' as const,
      reviewRequired: null,
      pendingRevision: Prisma.DbNull,
      revisionStatus: null,
      publishedAt: now,
      publishedById: actor.userId,
    };
    let food: { id: string; version: number };
    if (existing) {
      await tx.foodNutrient.deleteMany({ where: { foodId: existing.id } });
      await tx.foodUnit.deleteMany({ where: { foodId: existing.id } });
      food = await tx.foodItem.update({
        where: { id: existing.id },
        data: {
          ...foodData,
          version: existing.publishedAt ? existing.version + 1 : existing.version,
          nutrients: { create: toRows(composite.nutrients) },
          units: { create: recipe.units },
        },
      });
    } else {
      food = await tx.foodItem.create({
        data: {
          ...foodData,
          source: 'CURATED_RECIPE',
          sourceRef: row.slug,
          nutrients: { create: toRows(composite.nutrients) },
          units: { create: recipe.units },
        },
      });
    }
    await contentPublished(tx, { kind: 'recipe', id: row.id, version });
    await contentPublished(tx, { kind: 'food', id: food.id, version: food.version });
  }

  private async load(db: Tx, id: string, lock = false): Promise<RecipeRow> {
    if (lock) await db.$queryRaw`SELECT id FROM "Recipe" WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await db.recipe.findUnique({ where: { id }, include: recipeInclude });
    if (!row)
      throw new ProblemException(HttpStatus.NOT_FOUND, 'RECIPE_NOT_FOUND', 'No such recipe');
    return row;
  }
}

function effective(row: Pick<RecipeRow, 'pendingRevision'> & RecipeRow): EffectiveRecipe {
  const r = (row.pendingRevision as Revision | null) ?? {};
  return {
    name: r.name ?? row.name,
    localNames: r.localNames ?? row.localNames,
    cuisine: r.cuisine !== undefined ? r.cuisine : row.cuisine,
    cookedYieldG: r.cookedYieldG ?? Number(row.cookedYieldG),
    yieldMeasured: r.yieldMeasured ?? row.yieldMeasured,
    restaurantStyle: r.restaurantStyle ?? row.restaurantStyle,
    ingredients:
      r.ingredients ??
      row.ingredients.map((i) => ({ foodId: i.foodId, grams: Number(i.grams), note: i.note })),
    substitutions: r.substitutions ?? (row.substitutions as Substitution[]),
    units: r.units ?? (row.units as HouseholdUnit[]),
    steps: r.steps ?? row.steps,
  };
}

async function checkIngredients(
  tx: Tx,
  ingredients: { foodId: string }[],
  substitutions: Substitution[],
) {
  const ids = [
    ...new Set([
      ...ingredients.map((i) => i.foodId),
      ...substitutions.flatMap((s) => [s.ingredientFoodId, ...s.alternatives]),
    ]),
  ];
  const found = await tx.foodItem.findMany({
    where: { id: { in: ids }, source: { notIn: ['USER', 'CURATED_RECIPE'] } },
    select: { id: true },
  });
  const known = new Set(found.map((f) => f.id));
  const missing = ids.filter((i) => !known.has(i));
  if (missing.length > 0) {
    throw new ProblemException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'UNKNOWN_INGREDIENT',
      `Not catalogue ingredients: ${missing.join(', ')}`,
    );
  }
  const used = new Set(ingredients.map((i) => i.foodId));
  if (substitutions.some((s) => !used.has(s.ingredientFoodId))) {
    throw new ProblemException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'UNKNOWN_INGREDIENT',
      'A substitution names a food that is not an ingredient of this recipe',
    );
  }
}

async function applyPatch(tx: Tx, id: string, patch: Revision) {
  const { ingredients, substitutions, units, importFields: _ignored, ...scalars } = patch;
  if (ingredients) {
    await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
    await tx.recipeIngredient.createMany({
      data: ingredients.map((i, order) => ({ ...i, recipeId: id, order })),
    });
  }
  await tx.recipe.update({
    where: { id },
    data: {
      ...scalars,
      ...(substitutions ? { substitutions: substitutions as Prisma.InputJsonValue } : {}),
      ...(units ? { units: units as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

export function toAdminRecipe(row: RecipeRow): AdminRecipe {
  const { importFields: _ignored, ...pending } = (row.pendingRevision as Revision | null) ?? {};
  return {
    ...workflowState(row),
    id: row.id,
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
      foodId: i.foodId,
      name: i.food.name,
      grams: Number(i.grams),
      note: i.note,
    })),
    substitutions: row.substitutions as Substitution[],
    units: row.units as HouseholdUnit[],
    dietTags: row.dietTags,
    allergens: row.allergens,
    fastingOk: row.fastingOk,
    oilG: Number(row.oilG),
    foodId: row.food?.id ?? null,
    pendingRevision: row.pendingRevision ? (pending as AdminRecipePatch) : null,
  };
}
