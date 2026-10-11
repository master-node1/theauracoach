import type { INestApplication } from '@nestjs/common';
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
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';
import { PrismaService } from '../src/prisma.service';

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let prisma: PrismaService;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'profile_me');
  dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'profile-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 2 }),
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
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const get = (token: string) =>
  request(app.getHttpServer()).get('/v1/me').set('authorization', `Bearer ${token}`);

describe('GET /v1/me', () => {
  it('creates the user on first call and publishes UserRegistered once', async () => {
    const sub = randomUUID();
    const token = await dev.mintAccessToken({ sub, email: 'asha@example.com' });

    const first = await get(token).expect(200);
    expect(first.body).toMatchObject({
      email: 'asha@example.com',
      displayName: null,
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      onboardingComplete: false,
      status: 'ACTIVE',
      roles: ['user'],
    });
    expect(first.body.id).toBe(sub);
    const second = await get(token).expect(200);
    expect(second.body.id).toBe(first.body.id);

    const events = await prisma.outboxEvent.findMany({ where: { userId: first.body.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'UserRegistered', version: 1, publishedAt: null });
    expect((events[0]!.payload as { data: unknown }).data).toEqual({
      userId: first.body.id,
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
    });
  });

  it('handles concurrent first calls without creating two users', async () => {
    const sub = randomUUID();
    const token = await dev.mintAccessToken({ sub, email: `race-${sub}@example.com` });
    const results = await Promise.all([get(token), get(token), get(token)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await prisma.user.count({ where: { cognitoSub: sub } })).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { cognitoSub: sub } });
    expect(await prisma.outboxEvent.count({ where: { userId: user.id } })).toBe(1);
  });

  it('lists granted roles after the implicit user role', async () => {
    const sub = randomUUID();
    const token = await dev.mintAccessToken({ sub, email: `coach-${sub}@example.com` });
    const { body } = await get(token).expect(200);
    await prisma.role.upsert({
      where: { id: 'trainer' },
      create: { id: 'trainer', description: 'Trainer' },
      update: {},
    });
    await prisma.userRole.create({ data: { userId: body.id, roleId: 'trainer' } });
    expect((await get(token).expect(200)).body.roles).toEqual(['user', 'trainer']);
  });

  it('refuses to create an account when the token has no email', async () => {
    const token = await dev.mintAccessToken({ sub: randomUUID() });
    const res = await get(token).expect(403);
    expect(res.body.code).toBe('EMAIL_CLAIM_MISSING');
  });

  it('requires a token', async () => {
    await request(app.getHttpServer()).get('/v1/me').expect(401);
  });
});
