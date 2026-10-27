import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describeParticipantContract } from '@aura/testing';
import * as vitest from 'vitest';
import { Prisma, PrismaClient } from '../src/generated/prisma';
import { userDataPlan } from '../src/user-data-plan';

async function seed(prisma: PrismaClient, userId: string): Promise<void> {
  const day = new Date('2026-10-27');
  await prisma.bodyMeasurement.create({
    data: { userId, type: 'WEIGHT_KG', value: new Prisma.Decimal(62.5), measuredAt: new Date() },
  });
  await prisma.dailyCheckIn.create({ data: { userId, date: day, energy: 4, mood: 4 } });
  await prisma.deviceIntegration.create({
    data: { userId, provider: 'HEALTH_CONNECT', scopes: ['steps'] },
  });
  await prisma.workoutDayFact.create({ data: { userId, date: day, planned: 1 } });
  await prisma.nutritionDayFact.create({ data: { userId, date: day, totals: {} } });
  await prisma.exerciseBestFact.create({
    data: {
      userId,
      exerciseId: randomUUID(),
      exerciseName: 'Goblet squat',
      date: day,
      bestReps: 12,
    },
  });
}

describeParticipantContract(vitest, {
  service: 'progress-service',
  serviceDir: resolve(__dirname, '..'),
  plan: userDataPlan,
  models: Prisma.dmmf.datamodel.models,
  createClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  seed,
  redisDb: 9,
});
