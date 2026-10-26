import { randomUUID } from 'node:crypto';
import { SpanKind, trace } from '@opentelemetry/api';
import { Redis } from 'ioredis';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OutboxRelay, StreamConsumer, subscribe, writeOutbox, type SqlDatabase } from '../src';
import { EVENT_TABLES_SQL, pgDatabase } from './pg-database';
import { testTracer, useInMemoryTracing } from './tracing';

/** Same requirements as events.int.test.ts: TEST_DATABASE_URL and TEST_REDIS_URL. */
const serverUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
if (!serverUrl || !redisUrl) throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');

const exporter = useInMemoryTracing();
const dbName = `kit_tracing_${Date.now()}`;
let pool: Pool;
let db: SqlDatabase;
let redis: Redis;

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
  redis = new Redis(redisUrl, { db: 14 });
});

beforeEach(async () => {
  exporter.reset();
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

function userRegistered() {
  return { userId: randomUUID(), timezone: 'Asia/Kolkata', locale: 'en-IN' };
}

function write(data = userRegistered()) {
  return db.$transaction((tx) =>
    writeOutbox(tx, {
      producer: 'profile-service',
      key: 'UserRegistered@1',
      userId: data.userId,
      data,
    }),
  );
}

describe('trace propagation through the outbox and Redis Streams', () => {
  it('continues the producer trace in the relay and the consumer', async () => {
    let handlerTraceId: string | undefined;
    const { traceId, envelope } = await testTracer().startActiveSpan(
      'POST /v1/me',
      async (span) => {
        const envelope = await write();
        span.end();
        return { traceId: span.spanContext().traceId, envelope };
      },
    );
    expect(envelope.traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
    const { rows } = await pool.query('SELECT "traceparent" FROM "OutboxEvent"');
    expect(rows[0].traceparent).toBe(envelope.traceparent);

    expect(await new OutboxRelay(db, redis).runOnce()).toBe(1);

    const consumer = new StreamConsumer(db, redis, {
      group: 'notification-service',
      consumerName: 'test-1',
      subscriptions: [
        subscribe('UserRegistered@1', async () => {
          handlerTraceId = trace.getActiveSpan()?.spanContext().traceId;
        }),
      ],
    });
    await consumer.ensureGroups();
    expect(await consumer.pollOnce(100)).toEqual(['processed']);

    const spans = exporter.getFinishedSpans();
    const send = spans.find((s) => s.kind === SpanKind.PRODUCER);
    const process = spans.find((s) => s.kind === SpanKind.CONSUMER);
    expect(send?.name).toBe('send aura.UserRegistered.v1');
    expect(process?.name).toBe('process aura.UserRegistered.v1');
    expect(send?.spanContext().traceId).toBe(traceId);
    expect(process?.spanContext().traceId).toBe(traceId);
    expect(process?.attributes['messaging.message.id']).toBe(envelope.id);
    expect(process?.attributes['aura.event.outcome']).toBe('processed');
    expect(handlerTraceId).toBe(traceId);
  });

  it('starts a new trace for events written outside a trace and adds no publish span', async () => {
    const envelope = await write();
    expect(envelope.traceparent).toBeNull();
    await new OutboxRelay(db, redis).runOnce();
    const consumer = new StreamConsumer(db, redis, {
      group: 'notification-service',
      consumerName: 'test-1',
      subscriptions: [subscribe('UserRegistered@1', async () => undefined)],
    });
    await consumer.ensureGroups();
    expect(await consumer.pollOnce(100)).toEqual(['processed']);
    const spans = exporter.getFinishedSpans();
    expect(spans.filter((s) => s.kind === SpanKind.PRODUCER)).toHaveLength(0);
    const process = spans.find((s) => s.kind === SpanKind.CONSUMER);
    expect(process?.parentSpanContext).toBeUndefined();
  });

  it('marks the consumer span as an error when the handler fails', async () => {
    await testTracer().startActiveSpan('job', async (span) => {
      await write();
      span.end();
    });
    await new OutboxRelay(db, redis).runOnce();
    const consumer = new StreamConsumer(db, redis, {
      group: 'notification-service',
      consumerName: 'test-1',
      subscriptions: [
        subscribe('UserRegistered@1', async () => {
          throw new Error('downstream unavailable');
        }),
      ],
    });
    await consumer.ensureGroups();
    expect(await consumer.pollOnce(100)).toEqual(['failed']);
    const process = exporter.getFinishedSpans().find((s) => s.kind === SpanKind.CONSUMER);
    expect(process?.status.code).toBe(2);
    expect(process?.events.some((e) => e.name === 'exception')).toBe(true);
  });
});
