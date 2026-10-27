import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { streamKey } from '@aura/contracts';
import { LocalObjectStorage, StreamConsumer, participantSubscriptions } from '@aura/service-kit';
import { createTestDatabase, requireEnv, type TestDatabase } from '@aura/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { pauseSends, resumeSends } from '../src/subscriptions';
import { userDataPlan } from '../src/user-data-plan';

let db: TestDatabase;
let prisma: PrismaClient;
let redis: Redis;
let consumer: StreamConsumer;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'notification_hold');
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  redis = new Redis(requireEnv('TEST_REDIS_URL'), { db: 13 });
  await redis.flushdb();
  consumer = new StreamConsumer(prisma, redis, {
    group: 'notification-service',
    consumerName: 'test',
    subscriptions: participantSubscriptions({
      service: 'notification-service',
      plan: userDataPlan,
      storage: new LocalObjectStorage('/tmp/unused', 'http://localhost/files', 'k'.repeat(32)),
      onPending: pauseSends,
      onRestored: resumeSends,
    }),
  });
  await consumer.ensureGroups();
});

afterAll(async () => {
  await prisma?.$disconnect();
  redis?.disconnect();
  await db?.drop();
});

async function publish(type: string, data: object, occurredAt: Date) {
  const event = {
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: occurredAt.toISOString(),
    producer: 'profile-service',
    userId: (data as { userId: string }).userId,
    traceparent: null,
    data,
  };
  await redis.xadd(streamKey(type, 1), '*', 'event', JSON.stringify(event));
}

describe('sends during a pending deletion', () => {
  it('stop at once and resume after a restore', async () => {
    const userId = randomUUID();
    await prisma.notificationPreference.create({ data: { userId, mealReminderSlots: [] } });
    await prisma.notification.create({
      data: {
        userId,
        type: 'workout_reminder',
        channel: 'PUSH',
        scheduledFor: new Date(Date.now() + 3_600_000),
        dedupeKey: 'workout_reminder:2026-10-28',
        payload: {},
      },
    });
    const t0 = new Date();
    await publish(
      'AccountDeletionRequested',
      { userId, deletionDueAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
      t0,
    );
    await consumer.pollOnce(100);
    expect(await prisma.notificationPreference.findUnique({ where: { userId } })).toMatchObject({
      paused: true,
    });
    expect(await prisma.notification.findFirst({ where: { userId } })).toMatchObject({
      status: 'CANCELLED',
    });

    await publish('AccountRestored', { userId }, new Date(t0.getTime() + 1000));
    await consumer.pollOnce(100);
    expect(await prisma.notificationPreference.findUnique({ where: { userId } })).toMatchObject({
      paused: false,
    });
  });
});
