import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  configureHttpApp,
  describeRoutes,
  guardMatrixViolations,
  SERVICE_KIT_PUBLIC_ROUTES,
  UserTokenVerifier,
} from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  testEnv,
  type TestDatabase,
} from '@aura/testing';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';
import { PrismaClient } from '../src/generated/prisma';

let db: TestDatabase;
let app: INestApplication;
let dev: Awaited<ReturnType<typeof createDevIssuer>>;
let prisma: PrismaClient;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'notification');
  dev = await createDevIssuer();
  prisma = new PrismaClient({ datasources: { db: { url: db.url } } });
  const config = loadServiceConfig(
    testEnv({ service: 'notification-service', databaseUrl: db.url, issuer: dev.issuer }),
  );
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier)],
  }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await db?.drop();
});

describe('notification-service', () => {
  it('guards every route: public only if reviewed, internal under /internal/v1, admin with permissions', () => {
    expect(
      guardMatrixViolations(describeRoutes(app), { publicRoutes: SERVICE_KIT_PUBLIC_ROUTES }),
    ).toEqual([]);
  });

  it('is ready once its database and Redis answer', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('answers unknown routes with a problem document', async () => {
    const res = await request(app.getHttpServer()).get('/v1/does-not-exist').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('refuses a pending-deletion user with 423 and serves them again after a restore', async () => {
    const userId = randomUUID();
    await prisma.notificationPreference.create({ data: { userId, mealReminderSlots: [] } });
    const token = await dev.mintAccessToken({ sub: userId });
    const get = () =>
      request(app.getHttpServer())
        .get('/v1/me/notification-preferences')
        .set('authorization', `Bearer ${token}`);
    await get().expect(200);

    await prisma.accountState.create({
      data: { userId, pendingDeletion: true, deletionDueAt: new Date(), eventAt: new Date() },
    });
    const res = await get().expect(423);
    expect(res.body).toMatchObject({ status: 423, code: 'ACCOUNT_PENDING_DELETION' });

    await prisma.accountState.update({ where: { userId }, data: { pendingDeletion: false } });
    await get().expect(200);
  });
});
