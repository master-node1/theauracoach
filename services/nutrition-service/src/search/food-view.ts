import type { FoodDetail, HouseholdUnit, Nutrients } from '@aura/contracts';
import type { FoodFlag } from '@aura/domain/nutrition';
import type { Prisma } from '../generated/prisma';
import { fromRows } from '../catalogue/nutrients';
import { defaultUnit } from './food-search.service';

export const foodDetailInclude = {
  nutrients: true,
  units: { orderBy: { code: 'asc' } },
  cookedForms: { select: { id: true }, where: { status: 'PUBLISHED' } },
  recipe: { select: { slug: true } },
} satisfies Prisma.FoodItemInclude;
export type FoodDetailRow = Prisma.FoodItemGetPayload<{ include: typeof foodDetailInclude }>;

const num = (v: { toString(): string } | null) => (v === null ? null : Number(v.toString()));

export function toFoodDetail(row: FoodDetailRow): FoodDetail {
  const values = fromRows(row.nutrients);
  const nutrients = {
    energyKcal: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fibreG: 0,
    ...values,
  } as Nutrients;
  const units: HouseholdUnit[] = row.units.map((u) => ({
    code: u.code,
    label: u.label,
    grams: Number(u.grams),
  }));
  return {
    id: row.id,
    name: row.name,
    localNames: row.localNames,
    state: row.state,
    source: row.source,
    confidence: row.confidence,
    category: row.category,
    cuisine: row.cuisine,
    dietTags: row.dietTags,
    allergens: row.allergens,
    per100g: {
      energyKcal: nutrients.energyKcal,
      proteinG: nutrients.proteinG,
      carbsG: nutrients.carbsG,
      fatG: nutrients.fatG,
      fibreG: nutrients.fibreG,
    },
    defaultUnit: defaultUnit(row.units),
    warnings: [],
    sourceRef: row.sourceRef,
    flags: row.flags as FoodFlag[],
    nutrients,
    units,
    densityGPerMl: num(row.densityGPerMl),
    yieldFactor: num(row.yieldFactor),
    rawEquivalentId: row.rawEquivalentId,
    cookedFormIds: row.cookedForms.map((c) => c.id),
    recipeSlug: row.recipe?.slug ?? null,
    version: row.version,
  };
}
