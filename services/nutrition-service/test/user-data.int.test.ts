import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describeParticipantContract } from '@aura/testing';
import * as vitest from 'vitest';
import { Prisma, PrismaClient } from '../src/generated/prisma';
import { userDataPlan } from '../src/user-data-plan';

/** One row in every user table, including a food the user created and a planned recipe. */
async function seed(prisma: PrismaClient, userId: string): Promise<void> {
  const day = new Date('2026-10-27');
  await prisma.nutrient.upsert({
    where: { code: 'energy_kcal' },
    create: { code: 'energy_kcal', name: 'Energy', unit: 'kcal', isMacro: true },
    update: {},
  });
  const food = await prisma.foodItem.create({
    data: {
      name: 'Amma’s sambar',
      source: 'USER',
      confidence: 'MEDIUM',
      state: 'COOKED',
      createdById: userId,
      nutrients: { create: { nutrientCode: 'energy_kcal', per100: new Prisma.Decimal(85) } },
      units: { create: { code: 'katori', label: 'Katori', grams: new Prisma.Decimal(150) } },
    },
  });
  const recipe = await prisma.recipe.create({
    data: {
      slug: `poha-${randomUUID()}`,
      name: 'Poha',
      servings: 2,
      cookedYieldG: new Prisma.Decimal(400),
      prepMinutes: 10,
      cookMinutes: 15,
      substitutions: [],
    },
  });
  await prisma.mealPlan.create({
    data: {
      userId,
      weekStart: new Date('2026-10-26'),
      engineVersion: '1.0.0',
      items: {
        create: {
          date: day,
          slot: 'BREAKFAST',
          recipeId: recipe.id,
          servings: new Prisma.Decimal(1),
        },
      },
    },
  });
  await prisma.mealEntry.create({
    data: {
      userId,
      date: day,
      slot: 'LUNCH',
      foodId: food.id,
      quantity: new Prisma.Decimal(1),
      unitCode: 'katori',
      grams: new Prisma.Decimal(150),
      state: 'COOKED',
      nutrients: { energy_kcal: 128 },
      confidence: 'MEDIUM',
      method: 'search',
    },
  });
  await prisma.waterEntry.create({ data: { userId, date: day, ml: 250 } });
  await prisma.dailyNutritionSummary.create({
    data: { userId, date: day, totals: { energy_kcal: 128 }, waterMl: 250, entryCount: 1 },
  });
  await prisma.nutritionTarget.create({
    data: {
      userId,
      effectiveFrom: day,
      energyKcal: 1900,
      proteinG: 90,
      carbG: 230,
      fatG: 60,
      fibreG: 30,
      waterMl: 2500,
      micros: {},
      engineVersion: '1.0.0',
      rationale: {},
    },
  });
  await prisma.userNutritionProfile.create({
    data: {
      userId,
      sex: 'FEMALE',
      birthYear: 1994,
      heightCm: new Prisma.Decimal(160),
      activityLevel: 'LIGHT',
      dietType: 'VEGETARIAN',
      goalType: 'FAT_LOSS',
      timezone: 'Asia/Kolkata',
      sourceEventId: randomUUID(),
    },
  });
  await prisma.weightFact.create({
    data: { userId, measuredAt: new Date(), weightKg: new Prisma.Decimal(62.5) },
  });
}

describeParticipantContract(vitest, {
  service: 'nutrition-service',
  serviceDir: resolve(__dirname, '..'),
  plan: userDataPlan,
  models: Prisma.dmmf.datamodel.models,
  createClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  seed,
  afterPurge: async (prisma) => {
    // Catalogue recipes survive a user's deletion.
    vitest.expect(await prisma.recipe.count()).toBeGreaterThan(0);
  },
  redisDb: 8,
});
