import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describeParticipantContract } from '@aura/testing';
import * as vitest from 'vitest';
import { Prisma, PrismaClient } from '../src/generated/prisma';
import { userDataPlan } from '../src/user-data-plan';

/** One row in every user table, hanging off a fresh catalogue exercise. */
async function seed(prisma: PrismaClient, userId: string): Promise<void> {
  const exercise = await prisma.exercise.create({
    data: {
      slug: `squat-${randomUUID()}`,
      name: 'Goblet squat',
      movementPattern: 'squat',
      mechanics: 'compound',
      difficulty: 'BEGINNER',
    },
  });
  await prisma.equipment.upsert({
    where: { code: 'dumbbell' },
    create: { code: 'dumbbell', name: 'Dumbbell' },
    update: {},
  });
  const plan = await prisma.workoutPlan.create({
    data: { userId, engineVersion: '1.0.0', startDate: new Date('2026-10-26') },
  });
  const week = await prisma.workoutPlanWeek.create({
    data: { planId: plan.id, weekStart: new Date('2026-10-26'), weekIndex: 0, rationale: {} },
  });
  const session = await prisma.workoutSession.create({
    data: { userId, planWeekId: week.id, name: 'Day 1', scheduledDate: new Date('2026-10-27') },
  });
  await prisma.plannedExercise.create({
    data: {
      sessionId: session.id,
      order: 1,
      exerciseId: exercise.id,
      sets: 3,
      repMin: 8,
      repMax: 12,
      targetRpe: new Prisma.Decimal(7),
      restSec: 90,
    },
  });
  const set = await prisma.workoutSet.create({
    data: { sessionId: session.id, exerciseId: exercise.id, setNumber: 1, reps: 10 },
  });
  await prisma.personalRecord.create({
    data: {
      userId,
      exerciseId: exercise.id,
      kind: 'max_reps',
      value: new Prisma.Decimal(10),
      setId: set.id,
      achievedAt: new Date(),
    },
  });
  await prisma.userEquipment.create({ data: { userId, equipmentCode: 'dumbbell' } });
  await prisma.userTrainingProfile.create({
    data: {
      userId,
      sex: 'FEMALE',
      birthYear: 1994,
      experience: 'BEGINNER',
      location: 'HOME',
      trainingDays: [1, 3, 5],
      sessionMinutes: 45,
      intensityCap: 'STANDARD',
      conditions: [],
      timezone: 'Asia/Kolkata',
      goalType: 'GENERAL_FITNESS',
      sourceEventId: randomUUID(),
    },
  });
  await prisma.recoverySignal.create({ data: { userId, date: new Date('2026-10-27'), energy: 4 } });
}

describeParticipantContract(vitest, {
  service: 'workout-service',
  serviceDir: resolve(__dirname, '..'),
  plan: userDataPlan,
  models: Prisma.dmmf.datamodel.models,
  createClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  seed,
  redisDb: 7,
});
