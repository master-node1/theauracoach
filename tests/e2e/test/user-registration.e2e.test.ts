import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureHttpApp, UserTokenVerifier } from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Tests may reach into services; services themselves may not import each other.
import { AppModule as NotificationApp } from '../../../services/notification-service/src/app.module';
import { loadServiceConfig as notificationConfig } from '../../../services/notification-service/src/config';
import { WorkerModule as NotificationWorker } from '../../../services/notification-service/src/worker.module';
import { AppModule as ProfileApp } from '../../../services/profile-service/src/app.module';
import { loadServiceConfig as profileConfig } from '../../../services/profile-service/src/config';
import { WorkerModule as ProfileWorker } from '../../../services/profile-service/src/worker.module';

const REDIS_DB = 4;
let dev: DevIssuer;
const dbs: TestDatabase[] = [];
const contexts: INestApplicationContext[] = [];
let profile: INestApplication;
let notification: INestApplication;

async function httpApp(module: Parameters<typeof Test.createTestingModule>[0]['imports']) {
  const ref = await Test.createTestingModule({ imports: module }).compile();
  const app = configureHttpApp(ref.createNestApplication());
  await app.init();
  contexts.push(app);
  return app;
}

async function worker(module: Parameters<typeof Test.createTestingModule>[0]['imports']) {
  const ref = await Test.createTestingModule({ imports: module }).compile();
  const ctx = ref.createNestApplication();
  await ctx.init();
  contexts.push(ctx);
}

beforeAll(async () => {
  dev = await createDevIssuer();
  const verifier = () =>
    new UserTokenVerifier({
      jwksUrl: 'http://unused',
      issuer: dev.issuer,
      clientIds: [DEV_CLIENT_ID],
      keySource: dev.keySource,
    });

  const profileDb = await createTestDatabase(
    resolve(__dirname, '../../../services/profile-service'),
    'e2e_profile',
  );
  const notificationDb = await createTestDatabase(
    resolve(__dirname, '../../../services/notification-service'),
    'e2e_notification',
  );
  dbs.push(profileDb, notificationDb);

  const pc = profileConfig(
    testEnv({
      service: 'profile-service',
      databaseUrl: profileDb.url,
      issuer: dev.issuer,
      redisDb: REDIS_DB,
    }),
  );
  const nc = notificationConfig(
    testEnv({
      service: 'notification-service',
      databaseUrl: notificationDb.url,
      issuer: dev.issuer,
      redisDb: REDIS_DB,
    }),
  );

  profile = await httpApp([ProfileApp.register(pc, verifier())]);
  notification = await httpApp([NotificationApp.register(nc, verifier())]);
  await worker([ProfileWorker.register(pc)]);
  await worker([NotificationWorker.register(nc)]);
});

afterAll(async () => {
  for (const ctx of contexts.reverse()) await ctx.close();
  for (const db of dbs) await db.drop();
});

async function eventually<T>(fn: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('user registration across services', () => {
  it('signing in creates the user in profile-service and default reminders in notification-service', async () => {
    const userId = randomUUID();
    const token = await dev.mintAccessToken({ sub: userId, email: `e2e-${userId}@example.com` });

    // Before the first sign-in nothing exists downstream.
    await request(notification.getHttpServer())
      .get('/v1/me/notification-preferences')
      .set('authorization', `Bearer ${token}`)
      .expect(404);

    const me = await request(profile.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.id).toBe(userId);

    // profile outbox -> relay -> Redis Streams -> notification consumer
    const prefs = await eventually(async () => {
      const res = await request(notification.getHttpServer())
        .get('/v1/me/notification-preferences')
        .set('authorization', `Bearer ${token}`);
      return res.status === 200 ? res.body : undefined;
    });
    expect(prefs).toEqual({
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
      workoutReminder: true,
      workoutReminderMinutesBefore: 30,
      mealReminders: true,
      mealReminderSlots: [],
      weeklySummary: true,
      inactivityNudges: 2,
    });
  });
});
