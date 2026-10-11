import { randomUUID } from 'node:crypto';
import { deadLetterKey, streamKey } from '@aura/contracts';
import { Redis } from 'ioredis';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxRelay, StreamConsumer, subscribe, writeOutbox, type SqlDatabase } from '../src';
import { EVENT_TABLES_SQL, pgDatabase } from './pg-database';

/**
 * Needs Postgres and Redis: TEST_DATABASE_URL (a server URL; a scratch database is created)
 * and TEST_REDIS_URL. CI provides both as service containers.
 */
const serverUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!serverUrl || !redisUrl) throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');

const dbName = `kit_events_${Date.now()}`;
let pool: Pool;
let db: SqlDatabase;
let redis: Redis;
const stream = streamKey('UserRegistered', 1);
const dlq = deadLetterKey('notification-service');

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
  redis = new Redis(redisUrl, { db: 15 });
});

beforeEach(async () => {
  await redis.flushdb();
  await pool.query('TRUNCATE "OutboxEvent", "ProcessedEvent", "Seen"');
});

afterAll(async () => {
  await pool?.end();
  redis?.disconnect();
  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});

function userRegistered(userId = randomUUID()) {
  return { userId, timezone: 'Asia/Kolkata', locale: 'en-IN' };
}

function consumer(
  handle?: (userId: string) => Promise<void>,
  opts: { maxDeliveries?: number } = {},
) {
  return new StreamConsumer(db, redis, {
    group: 'notification-service',
    consumerName: 'test-1',
    reclaimIdleMs: 0,
    maxDeliveries: opts.maxDeliveries ?? 5,
    subscriptions: [
      subscribe('UserRegistered@1', async (event, tx) => {
        await handle?.(event.data.userId);
        await tx.$executeRawUnsafe(
          `INSERT INTO "Seen" ("userId", "timezone") VALUES ($1::uuid, $2)`,
          event.data.userId,
          event.data.timezone,
        );
      }),
    ],
  });
}

describe('outbox', () => {
  it('writes nothing when the surrounding transaction rolls back', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await writeOutbox(tx, {
          producer: 'profile-service',
          key: 'UserRegistered@1',
          userId: null,
          data: userRegistered(),
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "OutboxEvent"');
    expect(rows[0].n).toBe(0);
  });

  it('refuses data that does not match the event schema', async () => {
    await expect(
      db.$transaction((tx) =>
        writeOutbox(tx, {
          producer: 'profile-service',
          key: 'UserRegistered@1',
          userId: null,
          data: { userId: 'nope', timezone: '', locale: '' },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('relay and consumer', () => {
  it('publishes committed events once and the consumer applies them once', async () => {
    const data = userRegistered();
    await db.$transaction((tx) =>
      writeOutbox(tx, {
        producer: 'profile-service',
        key: 'UserRegistered@1',
        userId: data.userId,
        data,
      }),
    );
    const relay = new OutboxRelay(db, redis);
    expect(await relay.runOnce()).toBe(1);
    expect(await relay.runOnce()).toBe(0);
    expect(await redis.xlen(stream)).toBe(1);

    const c = consumer();
    await c.ensureGroups();
    expect(await c.pollOnce(100)).toEqual(['processed']);
    const { rows } = await pool.query('SELECT * FROM "Seen"');
    expect(rows).toEqual([{ userId: data.userId, timezone: 'Asia/Kolkata' }]);
  });

  it('applies a redelivered event only once', async () => {
    const data = userRegistered();
    await db.$transaction((tx) =>
      writeOutbox(tx, {
        producer: 'profile-service',
        key: 'UserRegistered@1',
        userId: data.userId,
        data,
      }),
    );
    const relay = new OutboxRelay(db, redis);
    await relay.runOnce();
    // Simulate the relay crashing after XADD but before marking the row published.
    await pool.query('UPDATE "OutboxEvent" SET "publishedAt" = NULL');
    await relay.runOnce();
    expect(await redis.xlen(stream)).toBe(2);

    const c = consumer();
    await c.ensureGroups();
    expect(await c.pollOnce(100)).toEqual(['processed', 'duplicate']);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "Seen"');
    expect(rows[0].n).toBe(1);
  });

  it('retries a failed handler and rolls back its partial writes', async () => {
    const data = userRegistered();
    await db.$transaction((tx) =>
      writeOutbox(tx, {
        producer: 'profile-service',
        key: 'UserRegistered@1',
        userId: data.userId,
        data,
      }),
    );
    await new OutboxRelay(db, redis).runOnce();
    let calls = 0;
    const c = consumer(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
    });
    await c.ensureGroups();
    expect(await c.pollOnce(100)).toEqual(['failed']);
    const processed = await pool.query('SELECT count(*)::int AS n FROM "ProcessedEvent"');
    expect(processed.rows[0].n).toBe(0);
    expect(await c.reclaimOnce()).toEqual(['processed']);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM "Seen"');
    expect(rows[0].n).toBe(1);
  });

  it('dead-letters an event that keeps failing', async () => {
    const data = userRegistered();
    await db.$transaction((tx) =>
      writeOutbox(tx, {
        producer: 'profile-service',
        key: 'UserRegistered@1',
        userId: data.userId,
        data,
      }),
    );
    await new OutboxRelay(db, redis).runOnce();
    const c = consumer(
      async () => {
        throw new Error('always');
      },
      { maxDeliveries: 3 },
    );
    await c.ensureGroups();
    expect(await c.pollOnce(100)).toEqual(['failed']); // delivery 1
    expect(await c.reclaimOnce()).toEqual(['failed']); // delivery 2
    expect(await c.reclaimOnce()).toEqual(['failed']); // delivery 3
    expect(await c.reclaimOnce()).toEqual(['dead-lettered']);
    expect(await redis.xlen(dlq)).toBe(1);
    const pending = (await redis.xpending(stream, 'notification-service')) as [
      number,
      ...unknown[],
    ];
    expect(pending[0]).toBe(0);
  });

  it('dead-letters malformed entries at once', async () => {
    await redis.xadd(stream, '*', 'event', '{"not":"an envelope"}');
    const c = consumer();
    await c.ensureGroups();
    expect(await c.pollOnce(100)).toEqual(['dead-lettered']);
    const [entry] = (await redis.xrange(dlq, '-', '+')) as [string, string[]][];
    expect(entry?.[1]).toContain('reason');
  });

  it('lets two relays share the outbox without publishing twice', async () => {
    for (let i = 0; i < 30; i++) {
      const data = userRegistered();
      await db.$transaction((tx) =>
        writeOutbox(tx, {
          producer: 'profile-service',
          key: 'UserRegistered@1',
          userId: data.userId,
          data,
        }),
      );
    }
    const a = new OutboxRelay(db, redis, { batchSize: 10 });
    const b = new OutboxRelay(db, redis, { batchSize: 10 });
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const [x, y] = await Promise.all([a.runOnce(), b.runOnce()]);
      total += x + y;
    }
    expect(total).toBe(30);
    expect(await redis.xlen(stream)).toBe(30);
  });
});
