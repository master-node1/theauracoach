import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { streamKey } from '@aura/contracts';
import { StreamConsumer } from '@aura/service-kit';
import { createTestDatabase, requireEnv, type TestDatabase } from '@aura/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { subscriptions } from '../src/subscriptions';

let db: TestDatabase;
let prisma: PrismaClient;
let redis: Redis;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'notification_ur');
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  redis = new Redis(requireEnv('TEST_REDIS_URL'), { db: 3 });
  await redis.flushdb();
});

afterAll(async () => {
  await prisma?.$disconnect();
  redis?.disconnect();
  await db?.drop();
});

function envelope(userId: string, timezone = 'Asia/Kolkata') {
  return {
    id: randomUUID(),
    type: 'UserRegistered',
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'profile-service',
    userId,
    traceparent: null,
    data: { userId, timezone, locale: 'en-IN' },
  };
}

describe('UserRegistered consumer', () => {
  it('creates default preferences once, even when the event is delivered twice', async () => {
    const consumer = new StreamConsumer(prisma, redis, {
      group: 'notification-service',
      consumerName: 'test',
      subscriptions,
    });
    await consumer.ensureGroups();
    const userId = randomUUID();
    const event = JSON.stringify(envelope(userId, 'Europe/London'));
    await redis.xadd(streamKey('UserRegistered', 1), '*', 'event', event);
    await redis.xadd(streamKey('UserRegistered', 1), '*', 'event', event);

    expect(await consumer.pollOnce(100)).toEqual(['processed', 'duplicate']);
    const prefs = await prisma.notificationPreference.findUniqueOrThrow({ where: { userId } });
    expect(prefs).toMatchObject({
      timezone: 'Europe/London',
      workoutReminder: true,
      quietHoursStart: '22:00',
    });
  });
});
