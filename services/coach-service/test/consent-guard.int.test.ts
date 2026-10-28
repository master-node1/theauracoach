import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { streamKey } from '@aura/contracts';
import {
  configureHttpApp,
  RequiresConsent,
  StreamConsumer,
  UserTokenVerifier,
} from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  requireEnv,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';
import { PrismaService } from '../src/prisma.service';
import { subscriptions } from '../src/subscriptions';

/** Stands in for the coach endpoints, which arrive with the coach chat ticket. */
@Controller('v1/coach/probe')
class ProbeController {
  @RequiresConsent('AI_COACH')
  @Get()
  probe() {
    return { ok: true };
  }
}

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let redis: Redis;
let consumer: StreamConsumer;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'coach_consent');
  dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'coach-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 7 }),
  );
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  @Module({ imports: [AppModule.register(config, verifier)], controllers: [ProbeController] })
  class ProbeModule {}
  const ref = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
  redis = new Redis(requireEnv('TEST_REDIS_URL'), { db: 7 });
  await redis.flushdb();
  consumer = new StreamConsumer(app.get(PrismaService), redis, {
    group: 'coach-service',
    consumerName: 'test',
    subscriptions,
  });
  await consumer.ensureGroups();
});

afterAll(async () => {
  await app?.close();
  redis?.disconnect();
  await db?.drop();
});

async function consent(userId: string, granted: boolean, occurredAt: string): Promise<void> {
  const event = {
    id: randomUUID(),
    type: 'ConsentChanged',
    version: 1,
    occurredAt,
    producer: 'profile-service',
    userId,
    traceparent: null,
    data: { userId, purpose: 'AI_COACH', granted, policyVersion: '2026-10' },
  };
  await redis.xadd(streamKey('ConsentChanged', 1), '*', 'event', JSON.stringify(event));
  await consumer.pollOnce(100);
}

describe('ConsentGuard on coach-service (TC-PRV-4)', () => {
  it('follows AI_COACH consent from events alone', async () => {
    const userId = randomUUID();
    const probe = async () =>
      request(app.getHttpServer())
        .get('/v1/coach/probe')
        .set('authorization', `Bearer ${await dev.mintAccessToken({ sub: userId })}`);

    // Never heard of: closed.
    await probe().then((r) => expect(r.body).toMatchObject({ code: 'CONSENT_REQUIRED' }));

    await consent(userId, true, '2026-10-27T10:00:00.000Z');
    await probe().then((r) => expect(r.status).toBe(200));

    await consent(userId, false, '2026-10-27T10:05:00.000Z');
    const withdrawn = await probe();
    expect(withdrawn.status).toBe(403);
    expect(withdrawn.body).toMatchObject({ code: 'CONSENT_REQUIRED', purpose: 'AI_COACH' });

    // A late, older grant does not reopen it.
    await consent(userId, true, '2026-10-27T10:01:00.000Z');
    await probe().then((r) => expect(r.status).toBe(403));

    await consent(userId, true, '2026-10-27T10:10:00.000Z');
    await probe().then((r) => expect(r.status).toBe(200));
  });
});
