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
let consumer: StreamConsumer;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'notification_uu');
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  redis = new Redis(requireEnv('TEST_REDIS_URL'), { db: 5 });
  await redis.flushdb();
  consumer = new StreamConsumer(prisma, redis, {
    group: 'notification-service',
    consumerName: 'test',
    subscriptions,
  });
  await consumer.ensureGroups();
});

afterAll(async () => {
  await prisma?.$disconnect();
  redis?.disconnect();
  await db?.drop();
});

async function publish(type: string, userId: string, data: object): Promise<void> {
  const event = {
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    producer: 'profile-service',
    userId,
    traceparent: null,
    data: { userId, ...data },
  };
  await redis.xadd(streamKey(type, 1), '*', 'event', JSON.stringify(event));
}

describe('ConsentChanged and ProfileChanged consumers', () => {
  it('copies notification consent, even before UserRegistered arrives', async () => {
    const userId = randomUUID();
    await publish('ConsentChanged', userId, {
      purpose: 'NOTIFICATIONS',
      granted: true,
      policyVersion: '2026-10',
    });
    await publish('ConsentChanged', userId, {
      purpose: 'AI_COACH',
      granted: false,
      policyVersion: '2026-10',
    });
    await consumer.pollOnce(100);
    const prefs = await prisma.notificationPreference.findUniqueOrThrow({ where: { userId } });
    expect(prefs.consented).toBe(true);
  });

  it('follows time zone changes and ignores other profile fields', async () => {
    const userId = randomUUID();
    await prisma.notificationPreference.create({ data: { userId, mealReminderSlots: [] } });
    await publish('ProfileChanged', userId, {
      fields: ['timezone', 'heightCm'],
      changes: { timezone: 'Europe/London', heightCm: 170 },
    });
    await publish('ProfileChanged', userId, { fields: ['heightCm'], changes: { heightCm: 171 } });
    await consumer.pollOnce(100);
    const prefs = await prisma.notificationPreference.findUniqueOrThrow({ where: { userId } });
    expect(prefs).toMatchObject({ timezone: 'Europe/London', locale: 'en-IN' });
  });
});
