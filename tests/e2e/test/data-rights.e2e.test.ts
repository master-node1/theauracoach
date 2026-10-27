import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DATA_PARTICIPANTS, type ServiceName } from '@aura/contracts';
import { configureHttpApp, UserTokenVerifier } from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { strFromU8, unzipSync } from 'fflate';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Tests may reach into services; services themselves may not import each other.
import { WorkerModule as AuditWorker } from '../../../services/audit-service/src/worker.module';
import { loadServiceConfig as auditConfig } from '../../../services/audit-service/src/config';
import { WorkerModule as CoachWorker } from '../../../services/coach-service/src/worker.module';
import { loadServiceConfig as coachConfig } from '../../../services/coach-service/src/config';
import { PrismaClient as CoachDb } from '../../../services/coach-service/src/generated/prisma';
import { AppModule as NotificationApp } from '../../../services/notification-service/src/app.module';
import { loadServiceConfig as notificationConfig } from '../../../services/notification-service/src/config';
import { WorkerModule as NotificationWorker } from '../../../services/notification-service/src/worker.module';
import { WorkerModule as NutritionWorker } from '../../../services/nutrition-service/src/worker.module';
import { loadServiceConfig as nutritionConfig } from '../../../services/nutrition-service/src/config';
import { AppModule as ProfileApp } from '../../../services/profile-service/src/app.module';
import { loadServiceConfig as profileConfig } from '../../../services/profile-service/src/config';
import { NoIdentityAdmin } from '../../../services/profile-service/src/privacy/identity-admin';
import { PrivacyJobs } from '../../../services/profile-service/src/privacy/privacy-jobs';
import { WorkerModule as ProfileWorker } from '../../../services/profile-service/src/worker.module';
import { WorkerModule as ProgressWorker } from '../../../services/progress-service/src/worker.module';
import { loadServiceConfig as progressConfig } from '../../../services/progress-service/src/config';
import { WorkerModule as WorkoutWorker } from '../../../services/workout-service/src/worker.module';
import { loadServiceConfig as workoutConfig } from '../../../services/workout-service/src/config';
import { PrismaClient as WorkoutDb } from '../../../services/workout-service/src/generated/prisma';

/** Its own Redis database: these workers consume every privacy stream. */
const REDIS_DB = 0;
const DAY = 86_400_000;
let dev: DevIssuer;
let storageDir: string;
const dbs: TestDatabase[] = [];
const contexts: INestApplicationContext[] = [];
let profile: INestApplication;
let notification: INestApplication;
let jobs: PrivacyJobs;
let workoutDb: WorkoutDb;
let coachDb: CoachDb;
const identity = new NoIdentityAdmin();

async function boot(
  module: Parameters<typeof Test.createTestingModule>[0]['imports'],
  http: boolean,
) {
  const ref = await Test.createTestingModule({ imports: module }).compile();
  const app = http ? configureHttpApp(ref.createNestApplication()) : ref.createNestApplication();
  await app.init();
  contexts.push(app);
  return app;
}

beforeAll(async () => {
  dev = await createDevIssuer();
  storageDir = await mkdtemp(join(tmpdir(), 'aura-e2e-store-'));
  const verifier = () =>
    new UserTokenVerifier({
      jwksUrl: 'http://unused',
      issuer: dev.issuer,
      clientIds: [DEV_CLIENT_ID],
      keySource: dev.keySource,
    });
  const env = async (service: ServiceName) => {
    const db = await createTestDatabase(
      resolve(__dirname, `../../../services/${service}`),
      `e2e_rights_${service.split('-')[0]}`,
    );
    dbs.push(db);
    return {
      ...testEnv({ service, databaseUrl: db.url, issuer: dev.issuer, redisDb: REDIS_DB }),
      OBJECT_STORAGE_DIR: storageDir,
      OBJECT_STORAGE_PUBLIC_URL: 'http://localhost/v1/me/export-files',
      IDENTITY_ADMIN: 'none',
    };
  };

  const pc = profileConfig(await env('profile-service'));
  const nc = notificationConfig(await env('notification-service'));
  const wc = workoutConfig(await env('workout-service'));
  const cc = coachConfig(await env('coach-service'));
  workoutDb = new WorkoutDb({ datasources: { db: { url: wc.DATABASE_URL } } });
  coachDb = new CoachDb({ datasources: { db: { url: cc.DATABASE_URL } } });

  profile = (await boot(
    [ProfileApp.register(pc, verifier(), undefined, { identityAdmin: identity })],
    true,
  )) as INestApplication;
  notification = (await boot([NotificationApp.register(nc, verifier())], true)) as INestApplication;
  const profileWorker = await boot(
    [ProfileWorker.register(pc, { identityAdmin: identity })],
    false,
  );
  jobs = profileWorker.get(PrivacyJobs);
  await boot([NotificationWorker.register(nc)], false);
  await boot([WorkoutWorker.register(wc)], false);
  await boot([CoachWorker.register(cc)], false);
  await boot([NutritionWorker.register(nutritionConfig(await env('nutrition-service')))], false);
  await boot([ProgressWorker.register(progressConfig(await env('progress-service')))], false);
  await boot([AuditWorker.register(auditConfig(await env('audit-service')))], false);
}, 120_000);

afterAll(async () => {
  for (const ctx of contexts.reverse()) await ctx.close();
  await workoutDb?.$disconnect();
  await coachDb?.$disconnect();
  for (const db of dbs) await db.drop();
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('data rights across all seven services', () => {
  it('exports everything, then deletes everything after the grace period (TC-PRV-1/2)', async () => {
    const userId = randomUUID();
    const token = await dev.mintAccessToken({ sub: userId, email: `rights-${userId}@example.com` });
    const auth = { authorization: `Bearer ${token}` };
    const api = () => request(profile.getHttpServer());

    await api().get('/v1/me').set(auth).expect(200);
    await api()
      .post('/v1/me/consents')
      .set(auth)
      .send({ purpose: 'AI_COACH', granted: true, policyVersion: '2026-10' })
      .expect(201);
    await workoutDb.workoutSession.create({
      data: { userId, name: 'Day 1', scheduledDate: new Date('2026-10-27') },
    });
    await coachDb.usageRecord.create({
      data: {
        userId,
        feature: 'coach_chat',
        provider: 'anthropic',
        model: 'test-model',
        inputTokens: 1,
        outputTokens: 1,
        costMicroUsd: 1n,
        latencyMs: 1,
        outcome: 'ok',
        requestId: randomUUID(),
      },
    });

    // Export: every participant answers, profile-service zips.
    const started = await api().post('/v1/me/exports').set(auth).expect(202);
    const ready = await eventually(async () => {
      const res = await api().get(`/v1/me/exports/${started.body.id}`).set(auth);
      return res.body.status === 'ready' ? res.body : undefined;
    });
    const link = new URL(ready.downloadUrl);
    const file = await api()
      .get(`${link.pathname}${link.search}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const zip = unzipSync(new Uint8Array(file.body as Buffer));
    for (const service of ['profile-service', ...DATA_PARTICIPANTS]) {
      expect(Object.keys(zip)).toContain(`json/${service.replace(/-service$/, '')}.json`);
    }
    const workout = JSON.parse(strFromU8(zip['json/workout.json']!));
    expect(workout.tables.WorkoutSession).toEqual([expect.objectContaining({ name: 'Day 1' })]);

    // Deletion request: other services refuse the user while pending.
    const fresh = await dev.mintAccessToken({ sub: userId, email: `rights-${userId}@example.com` });
    await api().delete('/v1/me').set('authorization', `Bearer ${fresh}`).expect(202);
    await eventually(async () => {
      const res = await request(notification.getHttpServer())
        .get('/v1/me/notification-preferences')
        .set(auth);
      return res.status === 423 ? true : undefined;
    });

    // Grace period over: AccountDeleted fans out, every service confirms, profile-service finishes.
    await jobs.runOnce(new Date(Date.now() + 31 * DAY));
    await eventually(async () => {
      await jobs.runOnce(new Date(Date.now() + 31 * DAY));
      const me = await api().get('/v1/me').set(auth);
      return me.status === 403 && identity.deleted.includes(userId) ? true : undefined;
    });

    expect(await workoutDb.workoutSession.count({ where: { userId } })).toBe(0);
    expect(await coachDb.usageRecord.count({ where: { userId } })).toBe(0);
    expect(await coachDb.usageRecord.count({ where: { userId: null } })).toBe(1);
    await expect(
      request(profile.getHttpServer()).get(`${link.pathname}${link.search}`).expect(404),
    ).resolves.toBeDefined();
  });
});
