import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AdminContentListQuery,
  AdminFood,
  AdminFoodInput,
  AdminFoodPatch,
  AdminPage,
  ContentAction,
} from '@aura/contracts';
import { compatibleDiets, type FoodFlag } from '@aura/domain/nutrition';
import { ProblemException, type AuthenticatedUser } from '@aura/service-kit';
import { Prisma } from '../generated/prisma';
import { energyCheck, fromRows, toRows, type NutrientValues } from '../catalogue/nutrients';
import { PrismaService } from '../prisma.service';
import { FoodSearchService } from '../search/food-search.service';
import { foodDetailInclude, toFoodDetail, type FoodDetailRow } from '../search/food-view';
import { audit, contentPublished, stateOf, workflowState, workflowStep, editTarget } from './content-workflow';

type Tx = Prisma.TransactionClient;

const REFERENCE_SOURCES = ['IFCT_2017', 'USDA_FDC', 'OPEN_FOOD_FACTS'];

/** Admin foods (admin LLD §2, nutrition LLD §7). USER foods are personal data and never listed. */
@Injectable()
export class AdminFoodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: FoodSearchService,
  ) {}

  async list(query: AdminContentListQuery): Promise<AdminPage<AdminFood>> {
    const where: Prisma.FoodItemWhereInput = {
      source: { not: 'USER' },
      ...(query.status ? { status: query.status } : {}),
      ...(query.qa === 'flagged' ? { NOT: { qaFlags: { isEmpty: true } } } : {}),
      ...(query.q ? { searchText: { contains: query.q.toLowerCase() } } : {}),
      ...(query.cursor ? { id: { gt: query.cursor } } : {}),
    };
    const rows = await this.prisma.foodItem.findMany({
      where,
      include: foodDetailInclude,
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminFood),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  async get(id: string): Promise<AdminFood> {
    return toAdminFood(await this.load(this.prisma, id));
  }

  async create(actor: AuthenticatedUser, input: AdminFoodInput, requestId?: string) {
    const id = await this.prisma.$transaction(async (tx) => {
      await this.checkRawEquivalent(tx, input.rawEquivalentId, null);
      const created = await tx.foodItem.create({
        data: {
          ...scalarData(input),
          source: input.source,
          status: 'DRAFT',
          nutrients: { create: toRows(input.nutrients) },
          units: { create: input.units },
        },
      });
      await audit(tx, {
        actor,
        permission: 'food:write',
        action: 'food.create',
        entityType: 'food',
        entityId: created.id,
        before: null,
        after: { name: input.name, source: input.source, status: 'DRAFT' },
        requestId,
      });
      return created.id;
    });
    return this.get(id);
  }

  async patch(actor: AuthenticatedUser, id: string, patch: AdminFoodPatch, requestId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const row = await this.load(tx, id, true);
      if (patch.source !== undefined && !REFERENCE_SOURCES.concat('CURATED_INGREDIENT').includes(row.source)) {
        throw new ProblemException(HttpStatus.UNPROCESSABLE_ENTITY, 'SOURCE_FIXED', 'This food’s source cannot change');
      }
      await this.checkRawEquivalent(tx, patch.rawEquivalentId ?? null, id);
      if (editTarget(row) === 'item') {
        await applyPatch(tx, id, patch);
      } else {
        const merged = { ...((row.pendingRevision as AdminFoodPatch | null) ?? {}), ...patch };
        await tx.foodItem.update({
          where: { id },
          data: { pendingRevision: merged as Prisma.InputJsonValue, revisionStatus: 'DRAFT' },
        });
      }
      await audit(tx, {
        actor,
        permission: 'food:write',
        action: 'food.update',
        entityType: 'food',
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
  ): Promise<AdminFood> {
    let published = false;
    await this.prisma.$transaction(async (tx) => {
      const row = await this.load(tx, id, true);
      const step = workflowStep(row, action);
      const permission =
        action === 'submit' ? 'food:write' : action === 'reject' ? 'food:review' : 'food:publish';

      if (action === 'publish') {
        const revision = step.target === 'revision' ? (row.pendingRevision as AdminFoodPatch) : {};
        validateForPublish(row, revision);
        if (step.target === 'revision') await applyPatch(tx, id, revision);
        const version = row.publishedAt ? row.version + 1 : row.version;
        await tx.foodItem.update({
          where: { id },
          data: {
            status: 'PUBLISHED',
            version,
            pendingRevision: Prisma.DbNull,
            revisionStatus: null,
            reviewRequired: null,
            publishedAt: new Date(),
            publishedById: actor.userId,
          },
        });
        await contentPublished(tx, {
          contentType: 'food',
          contentId: id,
          slug: row.slug,
          version,
          publishedBy: actor.userId,
        });
        published = true;
      } else if (action === 'archive') {
        await tx.foodItem.update({
          where: { id },
          data: { status: 'ARCHIVED', pendingRevision: Prisma.DbNull, revisionStatus: null },
        });
        published = true;
      } else if (step.target === 'revision') {
        await tx.foodItem.update({ where: { id }, data: { revisionStatus: step.to } });
      } else {
        await tx.foodItem.update({ where: { id }, data: { status: step.to } });
      }
      const after = await this.load(tx, id);
      await audit(tx, {
        actor,
        permission,
        action: `food.${action}`,
        entityType: 'food',
        entityId: id,
        before: stateOf(row),
        after: { ...stateOf(after), ...(note ? { note } : {}) },
        requestId,
      });
    });
    if (published) await this.search.invalidate();
    return this.get(id);
  }

  private async load(db: Tx, id: string, lock = false): Promise<FoodDetailRow> {
    if (lock) await db.$queryRaw`SELECT id FROM "FoodItem" WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await db.foodItem.findUnique({ where: { id }, include: foodDetailInclude });
    if (!row || row.source === 'USER') {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'FOOD_NOT_FOUND', 'No such food');
    }
    return row;
  }

  private async checkRawEquivalent(db: Tx, rawId: string | null, selfId: string | null) {
    if (!rawId) return;
    const raw = await db.foodItem.findUnique({ where: { id: rawId }, select: { state: true, source: true } });
    if (!raw || raw.source === 'USER' || raw.state !== 'RAW' || rawId === selfId) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'INVALID_RAW_EQUIVALENT',
        'rawEquivalentId must be another catalogue food in its RAW state',
      );
    }
  }
}

function scalarData(input: AdminFoodPatch) {
  const data: Prisma.FoodItemUncheckedUpdateInput & Prisma.FoodItemUncheckedCreateInput = {} as never;
  const keys = [
    'name',
    'localNames',
    'source',
    'sourceRef',
    'confidence',
    'state',
    'category',
    'cuisine',
    'allergens',
    'densityGPerMl',
    'rawEquivalentId',
    'yieldFactor',
  ] as const;
  for (const k of keys) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
  if (input.flags !== undefined) {
    data.flags = input.flags;
    data.dietTags = compatibleDiets(input.flags as FoodFlag[]);
  }
  return data;
}

async function applyPatch(tx: Tx, id: string, patch: AdminFoodPatch) {
  if (patch.nutrients) {
    await tx.foodNutrient.deleteMany({ where: { foodId: id } });
    await tx.foodNutrient.createMany({ data: toRows(patch.nutrients).map((r) => ({ ...r, foodId: id })) });
  }
  if (patch.units) {
    await tx.foodUnit.deleteMany({ where: { foodId: id } });
    await tx.foodUnit.createMany({ data: patch.units.map((u) => ({ ...u, foodId: id })) });
  }
  await tx.foodItem.update({ where: { id }, data: scalarData(patch) });
}

/** Publish rules (nutrition LLD §7): energy within ±15% of macros, a traceable source, gram units. */
export function validateForPublish(row: FoodDetailRow, revision: AdminFoodPatch) {
  const problems: string[] = [];
  const nutrients: NutrientValues = revision.nutrients ?? fromRows(row.nutrients);
  const check = energyCheck(nutrients);
  if (!check.ok) {
    problems.push(
      `energy ${check.statedKcal} kcal is ${Math.round(check.deviation * 100)}% off the ${Math.round(check.expectedKcal)} kcal its macros give (limit 15%)`,
    );
  }
  const source = revision.source ?? row.source;
  const sourceRef = revision.sourceRef !== undefined ? revision.sourceRef : row.sourceRef;
  if (REFERENCE_SOURCES.includes(source) && !sourceRef) {
    problems.push(`a ${source} food needs its sourceRef`);
  }
  if (!(revision.confidence ?? row.confidence)) problems.push('confidence is not set');
  const units = revision.units ?? row.units.map((u) => ({ ...u, grams: Number(u.grams) }));
  if (units.some((u) => !(u.grams > 0))) problems.push('every unit needs its weight in grams');
  if (problems.length > 0) {
    throw new ProblemException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      check.ok ? 'PUBLISH_VALIDATION_FAILED' : 'ENERGY_MISMATCH',
      `Cannot publish: ${problems.join('; ')}`,
    );
  }
}

export function toAdminFood(row: FoodDetailRow): AdminFood {
  return {
    ...toFoodDetail(row),
    ...workflowState(row),
    qaFlags: row.qaFlags,
    pendingRevision: (row.pendingRevision as AdminFoodPatch | null) ?? null,
  };
}
