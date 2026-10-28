import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { describeParticipantContract } from '@aura/testing';
import * as vitest from 'vitest';
import { Prisma, PrismaClient } from '../src/generated/prisma';
import { userDataPlan } from '../src/user-data-plan';

async function seed(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.notificationPreference.create({ data: { userId, mealReminderSlots: ['LUNCH'] } });
  await prisma.device.create({
    data: { userId, platform: 'ANDROID', pushToken: `token-${randomUUID()}`, appVersion: '0.1.0' },
  });
  await prisma.notification.create({
    data: {
      userId,
      type: 'workout_reminder',
      channel: 'PUSH',
      scheduledFor: new Date(),
      dedupeKey: 'workout_reminder:2026-10-27',
      payload: {},
    },
  });
  await prisma.suppressionFact.create({ data: { userId, key: 'workout_done:2026-10-27' } });
}

describeParticipantContract(vitest, {
  service: 'notification-service',
  serviceDir: resolve(__dirname, '..'),
  plan: userDataPlan,
  models: Prisma.dmmf.datamodel.models,
  createClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  seed,
  redisDb: 11,
});
