import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { streamKey } from '@aura/contracts';
import { StreamConsumer } from '@aura/service-kit';
import { createTestDatabase, requireEnv, type TestDatabase } from '@aura/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma';
import { subscriptions } from '../src/events/user-activity.subscription';

let db: TestDatabase;
let prisma: PrismaClient;
let redis: Redis;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'audit_activity');
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  redis = new Redis(requireEnv('TEST_REDIS_URL'), { db: 6 });
  await redis.flushdb();
});

afterAll(async () => {
  await prisma?.$disconnect();
  redis?.disconnect();
  await db?.drop();
});

function envelope(type: string, userId: string, data: object) {
  return JSON.stringify({
    id: randomUUID(),
    type,
    version: 1,
    occurredAt: '2026-10-26T10:00:00.000Z',
    producer: 'profile-service',
    userId,
    traceparent: null,
    data: { userId, ...data },
  });
}

describe('audit of user consent and profile changes', () => {
  it('records consents and profile field names once each, without profile values', async () => {
    const consumer = new StreamConsumer(prisma, redis, {
      group: 'audit-service',
      consumerName: 'test',
      subscriptions,
    });
    await consumer.ensureGroups();
    const userId = randomUUID();
    const consent = envelope('ConsentChanged', userId, {
      purpose: 'AI_COACH',
      granted: false,
      policyVersion: '2026-10',
    });
    await redis.xadd(streamKey('ConsentChanged', 1), '*', 'event', consent);
    await redis.xadd(streamKey('ConsentChanged', 1), '*', 'event', consent);
    await redis.xadd(
      streamKey('ProfileChanged', 1),
      '*',
      'event',
      envelope('ProfileChanged', userId, { fields: ['heightCm'], changes: { heightCm: 170 } }),
    );
    await consumer.pollOnce(100);

    const rows = await prisma.auditLog.findMany({
      where: { actorId: userId },
      orderBy: { action: 'asc' },
    });
    expect(rows.map((r) => [r.action, r.after])).toEqual([
      ['consent.withdraw', { purpose: 'AI_COACH', granted: false, policyVersion: '2026-10' }],
      ['profile.update', { fields: ['heightCm'] }],
    ]);
    expect(rows[0]!.createdAt.toISOString()).toBe('2026-10-26T10:00:00.000Z');
  });
});

describe('audit of admin actions', () => {
  it('stores AuditEvent once, with actor, entity and before/after', async () => {
    const consumer = new StreamConsumer(prisma, redis, {
      group: 'audit-service',
      consumerName: 'test',
      subscriptions,
    });
    await consumer.ensureGroups();
    const actorId = randomUUID();
    const targetId = randomUUID();
    const event = JSON.stringify({
      id: randomUUID(),
      type: 'AuditEvent',
      version: 1,
      occurredAt: '2026-10-27T11:00:00.000Z',
      producer: 'profile-service',
      userId: targetId,
      traceparent: null,
      data: {
        actorId,
        actorRole: 'owner',
        action: 'role.grant',
        entityType: 'user_role',
        entityId: `${targetId}:support`,
        before: null,
        after: { userId: targetId, role: 'support' },
        requestId: null,
      },
    });
    await redis.xadd(streamKey('AuditEvent', 1), '*', 'event', event);
    await redis.xadd(streamKey('AuditEvent', 1), '*', 'event', event);
    await consumer.pollOnce(100);

    const rows = await prisma.auditLog.findMany({ where: { actorId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorRole: 'owner',
      action: 'role.grant',
      entityType: 'user_role',
      entityId: `${targetId}:support`,
      before: null,
      after: { userId: targetId, role: 'support' },
    });
  });
});
