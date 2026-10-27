import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureHttpApp, mintServiceToken, UserTokenVerifier } from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  TEST_INTERNAL_SECRET,
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
  db = await createTestDatabase(resolve(__dirname, '..'), 'profile_settings');
  dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'profile-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 4 }),
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

const http = () => request(app.getHttpServer());

/** A signed-in user; `onboarded` also creates the profile onboarding would create. */
async function signUp(onboarded = false): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = await dev.mintAccessToken({ sub: id, email: `u-${id}@example.com` });
  await http().get('/v1/me').set('authorization', `Bearer ${token}`).expect(200);
  if (onboarded) {
    await prisma.profile.create({
      data: {
        userId: id,
        dateOfBirth: new Date('1992-03-01'),
        sex: 'FEMALE',
        heightCm: 162,
        activityLevel: 'LIGHT',
        experience: 'BEGINNER',
        dietType: 'VEGETARIAN',
        cuisines: ['south_indian'],
        allergens: [],
        dislikedFoodIds: [],
        fastingDays: [],
        trainingDays: [1, 3, 5],
        location: 'HOME',
        equipmentCodes: ['dumbbell'],
      },
    });
  }
  return { id, token };
}

const events = (userId: string, type: string) =>
  prisma.outboxEvent.findMany({ where: { userId, type }, orderBy: { createdAt: 'asc' } });

describe('GET /v1/me', () => {
  it('has no profile and default preferences before onboarding', async () => {
    const { token } = await signUp();
    const { body } = await http().get('/v1/me').set('authorization', `Bearer ${token}`).expect(200);
    expect(body.profile).toBeNull();
    expect(body.preferences).toEqual({ theme: 'system', coachTone: 'supportive' });
  });

  it('returns the profile once it exists', async () => {
    const { token } = await signUp(true);
    const { body } = await http().get('/v1/me').set('authorization', `Bearer ${token}`).expect(200);
    expect(body.profile).toMatchObject({
      dateOfBirth: '1992-03-01',
      heightCm: 162,
      equipment: ['dumbbell'],
      unitSystem: 'METRIC',
      intensityCap: 'STANDARD',
    });
  });
});

describe('PATCH /v1/me/profile', () => {
  const patch = (token: string, body: object) =>
    http().patch('/v1/me/profile').set('authorization', `Bearer ${token}`).send(body);

  it('changes account fields before onboarding but refuses profile fields', async () => {
    const { id, token } = await signUp();
    const ok = await patch(token, { displayName: 'Asha' }).expect(200);
    expect(ok.body).toEqual({ profile: null, proposals: [] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).displayName).toBe('Asha');
    expect(await events(id, 'ProfileChanged')).toHaveLength(0);

    const res = await patch(token, { heightCm: 170 }).expect(409);
    expect(res.body.code).toBe('PROFILE_NOT_CREATED');
  });

  it('rejects out-of-range values and names each field', async () => {
    const { token } = await signUp(true);
    const res = await patch(token, { heightCm: 300, sessionMinutes: 5, trainingDays: [9] }).expect(
      422,
    );
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['heightCm', 'sessionMinutes', 'trainingDays.0']),
    );
    await patch(token, { dateOfBirth: '1980-01-01' }).expect(422);
  });

  it('publishes one ProfileChanged with only the shared fields that changed', async () => {
    const { id, token } = await signUp(true);
    const res = await patch(token, {
      heightCm: 163.5,
      trainingDays: [1, 3, 5], // unchanged
      unitSystem: 'IMPERIAL', // not shared with other services
      timezone: 'Europe/London',
      displayName: 'Asha',
    }).expect(200);
    expect(res.body.profile).toMatchObject({ heightCm: 163.5, unitSystem: 'IMPERIAL' });

    const published = await events(id, 'ProfileChanged');
    expect(published).toHaveLength(1);
    expect((published[0]!.payload as { data: unknown }).data).toEqual({
      userId: id,
      fields: ['timezone', 'heightCm'],
      changes: { timezone: 'Europe/London', heightCm: 163.5 },
    });

    await patch(token, { heightCm: 163.5, timezone: 'Europe/London' }).expect(200);
    expect(await events(id, 'ProfileChanged')).toHaveLength(1);
  });
});

describe('preferences', () => {
  it('round-trips theme and coach tone', async () => {
    const { token } = await signUp();
    const auth = { authorization: `Bearer ${token}` };
    await http().patch('/v1/me/preferences').set(auth).send({ theme: 'dark' }).expect(200);
    const res = await http()
      .patch('/v1/me/preferences')
      .set(auth)
      .send({ coachTone: 'direct' })
      .expect(200);
    expect(res.body).toEqual({ theme: 'dark', coachTone: 'direct' });
    expect((await http().get('/v1/me/preferences').set(auth).expect(200)).body).toEqual(res.body);
    await http().patch('/v1/me/preferences').set(auth).send({ theme: 'neon' }).expect(422);
  });
});

describe('consents', () => {
  const post = (token: string, body: object) =>
    http().post('/v1/me/consents').set('authorization', `Bearer ${token}`).send(body);

  it('appends rows, returns the latest per purpose and publishes ConsentChanged', async () => {
    const { id, token } = await signUp();
    await post(token, { purpose: 'CORE_SERVICE', granted: true, policyVersion: '2026-10' }).expect(
      201,
    );
    await post(token, { purpose: 'AI_COACH', granted: true, policyVersion: '2026-10' }).expect(201);
    const withdrawn = await post(token, {
      purpose: 'AI_COACH',
      granted: false,
      policyVersion: '2026-10',
      channel: 'android',
    }).expect(201);
    expect(withdrawn.body).toMatchObject({ purpose: 'AI_COACH', granted: false });

    const { body } = await http()
      .get('/v1/me/consents')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(body.map((c: { purpose: string; granted: boolean }) => [c.purpose, c.granted])).toEqual([
      ['CORE_SERVICE', true],
      ['AI_COACH', false],
    ]);
    expect(await prisma.consent.count({ where: { userId: id } })).toBe(3);

    const published = await events(id, 'ConsentChanged');
    expect(published).toHaveLength(3);
    expect((published[2]!.payload as { data: unknown }).data).toEqual({
      userId: id,
      purpose: 'AI_COACH',
      granted: false,
      policyVersion: '2026-10',
    });
  });

  it('refuses to withdraw core service consent', async () => {
    const { id, token } = await signUp();
    const res = await post(token, {
      purpose: 'CORE_SERVICE',
      granted: false,
      policyVersion: '2026-10',
    }).expect(409);
    expect(res.body.code).toBe('CORE_CONSENT_REQUIRED');
    expect(await prisma.consent.count({ where: { userId: id } })).toBe(0);
  });

  it('keeps the latest state correct under rapid writes', async () => {
    const { token } = await signUp();
    for (let i = 0; i < 5; i++) {
      await post(token, { purpose: 'MARKETING', granted: i % 2 === 0, policyVersion: '1' });
    }
    const { body } = await http()
      .get('/v1/me/consents')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(body).toEqual([expect.objectContaining({ purpose: 'MARKETING', granted: true })]);
  });
});

describe('isolation and token checks', () => {
  it('only ever reads and changes the caller’s own data', async () => {
    const a = await signUp(true);
    const b = await signUp(true);
    await http()
      .patch('/v1/me/profile')
      .set('authorization', `Bearer ${a.token}`)
      .send({ heightCm: 180 })
      .expect(200);
    const { body } = await http()
      .get('/v1/me')
      .set('authorization', `Bearer ${b.token}`)
      .expect(200);
    expect(body.id).toBe(b.id);
    expect(body.profile.heightCm).toBe(162);
  });

  it('rejects expired, wrong-audience and ID tokens on every new route (TC-SEC-4)', async () => {
    const sub = randomUUID();
    const tokens = [
      await dev.mintAccessToken({ sub, expiresIn: '-1m' }),
      await dev.mintAccessToken({ sub, clientId: 'someone-else' }),
      await dev.mintIdToken({ sub, email: 'x@example.com', clientId: DEV_CLIENT_ID }),
    ];
    const routes: [string, string][] = [
      ['patch', '/v1/me/profile'],
      ['get', '/v1/me/preferences'],
      ['patch', '/v1/me/preferences'],
      ['get', '/v1/me/consents'],
      ['post', '/v1/me/consents'],
    ];
    for (const token of tokens) {
      for (const [method, path] of routes) {
        await (http() as unknown as Record<string, (p: string) => request.Test>)[method]!(path)
          .set('authorization', `Bearer ${token}`)
          .send({})
          .expect(401);
      }
    }
  });
});

describe('GET /internal/v1/users/{id}/context', () => {
  const tokens: Record<string, string> = {};
  beforeAll(async () => {
    for (const issuer of ['coach-service', 'workout-service'] as const) {
      tokens[issuer] = await mintServiceToken({
        secret: TEST_INTERNAL_SECRET,
        issuer,
        audience: 'profile-service',
      });
    }
  });
  const internal = (id: string, issuer: 'coach-service' | 'workout-service' = 'coach-service') =>
    http().get(`/internal/v1/users/${id}/context`).set('x-internal-token', tokens[issuer]!);

  it('gives coach-service the minimum context', async () => {
    const { id, token } = await signUp(true);
    await http()
      .patch('/v1/me/preferences')
      .set('authorization', `Bearer ${token}`)
      .send({ coachTone: 'direct' });
    const { body } = await internal(id).expect(200);
    expect(body).toEqual({
      userId: id,
      ageBand: expect.stringMatching(/^\d{2}-\d{2}$/),
      unitSystem: 'METRIC',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      coachTone: 'direct',
    });
  });

  it('returns a null age band before onboarding and 404 for unknown users', async () => {
    const { id } = await signUp();
    expect((await internal(id).expect(200)).body.ageBand).toBeNull();
    await internal(randomUUID()).expect(404);
  });

  it('rejects callers that are not allowed, user tokens and missing tokens', async () => {
    const { id, token } = await signUp();
    await internal(id, 'workout-service').expect(403);
    await http()
      .get(`/internal/v1/users/${id}/context`)
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });
});
