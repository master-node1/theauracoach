import { deadLetterKey, streamKey } from '@aura/contracts';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminOps, type AuthenticatedUser, type BaseConfig, type SqlDatabase } from '../src';
import { EVENT_TABLES_SQL, pgDatabase } from './pg-database';

/** Needs Postgres and Redis like events.int.test.ts; uses its own Redis db (12). */
const serverUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!serverUrl || !redisUrl) throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');

const dbName = `kit_admin_ops_${Date.now()}`;
let pool: Pool;
let db: SqlDatabase;
let redis: Redis;
let ops: AdminOps;
const dlq = deadLetterKey('coach-service');
const stream = streamKey('ConsentChanged', 1);
const owner: AuthenticatedUser = {
  userId: randomUUID(),
  groups: ['owner'],
  amr: ['pwd', 'mfa'],
  clientId: 'test',
};

beforeAll(async () => {
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const url = new URL(serverUrl);
  url.pathname = `/${dbName}`;
  pool = new Pool({ connectionString: url.toString() });
  await pool.query(EVENT_TABLES_SQL);
  db = pgDatabase(pool);
  redis = new Redis(redisUrl, { db: 12 });
  ops = new AdminOps(db, redis, { SERVICE_NAME: 'coach-service' } as BaseConfig, {
    title: 'Coach',
    userSummary: async (userId) => [{ label: 'Conversations', value: userId.length }],
    usage: async () => [{ key: 'x', label: 'X', value: 1 }],
  });
});

beforeEach(async () => {
  await redis.flushdb();
  await pool.query('TRUNCATE "OutboxEvent"');
});

afterAll(async () => {
  await pool?.end();
  redis?.disconnect();
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});

function envelope() {
  return JSON.stringify({
    id: randomUUID(),
    type: 'ConsentChanged',
    version: 1,
    occurredAt: '2026-10-27T10:00:00.000Z',
    producer: 'profile-service',
    userId: null,
    traceparent: null,
    data: {},
  });
}

const deadLetter = (event = envelope()) =>
  redis.xadd(dlq, '*', 'stream', stream, 'entryId', '1-0', 'reason', 'boom', 'event', event);

const auditRows = async () =>
  (
    await pool.query<{ payload: { data: Record<string, unknown> } }>(
      'SELECT payload FROM "OutboxEvent"',
    )
  ).rows;

describe('AdminOps', () => {
  it('lists dead letters without their payloads', async () => {
    const id = (await deadLetter())!;
    await deadLetter('not json');
    const list = await ops.dlq();
    expect(list.service).toBe('coach');
    expect(list.total).toBe(2);
    expect(list.entries[1]).toMatchObject({
      id,
      stream,
      entryId: '1-0',
      reason: 'boom',
      eventType: 'ConsentChanged@1',
    });
    expect(list.entries[0]).toMatchObject({ eventType: null, eventId: null });
    expect(JSON.stringify(list)).not.toContain('"data"');
  });

  it('replays an entry once, back to its stream, and audits it with the reason', async () => {
    const event = envelope();
    const id = (await deadLetter(event))!;
    const results = await Promise.allSettled([
      ops.replay(owner, id, { reason: 'consumer fixed' }, null),
      ops.replay(owner, id, { reason: 'consumer fixed' }, null),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'DLQ_ENTRY_NOT_FOUND' });

    const entries = (await redis.xrange(stream, '-', '+')) as [string, string[]][];
    expect(entries).toHaveLength(1);
    expect(entries[0]![1]).toEqual(['event', event]);
    expect(await redis.xlen(dlq)).toBe(0);

    const audits = await auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload.data).toMatchObject({
      actorId: owner.userId,
      actorRole: 'owner',
      action: 'event.replay',
      entityType: 'dead_letter',
      entityId: `coach:${id}`,
      reason: 'consumer fixed',
    });
  });

  it('refuses unknown ids and entries without an event, auditing nothing', async () => {
    await expect(ops.replay(owner, '99-0', { reason: 'try' }, null)).rejects.toMatchObject({
      code: 'DLQ_ENTRY_NOT_FOUND',
    });
    await expect(ops.replay(owner, 'x', { reason: 'try' }, null)).rejects.toMatchObject({
      code: 'DLQ_ENTRY_NOT_FOUND',
    });
    const empty = (await redis.xadd(dlq, '*', 'stream', stream, 'reason', 'boom', 'event', ''))!;
    await expect(ops.replay(owner, empty, { reason: 'try' }, null)).rejects.toMatchObject({
      code: 'DLQ_ENTRY_NOT_REPLAYABLE',
    });
    expect(await redis.xlen(dlq)).toBe(1);
    expect(await auditRows()).toHaveLength(0);
  });

  it('reports queue health, usage and the support section', async () => {
    await deadLetter();
    await pool.query(
      `INSERT INTO "OutboxEvent" ("id", "type", "payload", "createdAt") VALUES ($1, 'X', '{}', now() - interval '90 seconds')`,
      [randomUUID()],
    );
    const health = await ops.queues();
    expect(health).toMatchObject({ service: 'coach', outboxPending: 1, dlqLength: 1 });
    expect(health.outboxOldestAgeSeconds).toBeGreaterThanOrEqual(89);
    expect(await ops.usage(7)).toEqual({
      service: 'coach',
      metrics: [{ key: 'x', label: 'X', value: 1 }],
    });
    expect(await ops.userSection('abc')).toEqual({
      service: 'coach',
      title: 'Coach',
      fields: [{ label: 'Conversations', value: 3 }],
    });
    expect(() => ops.check('workout')).toThrow();
    expect(() => ops.check('coach')).not.toThrow();
  });
});
