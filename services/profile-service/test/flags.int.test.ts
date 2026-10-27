import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { catalogueDefaults } from '@aura/contracts';
import {
  configureHttpApp,
  createFeatureFlags,
  type FeatureFlags,
  UserTokenVerifier,
} from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let dir: string;
let flagsFile: string;
let flags: FeatureFlags;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'profile_flags');
  dev = await createDevIssuer();
  dir = await mkdtemp(join(tmpdir(), 'profile-flags-'));
  flagsFile = join(dir, 'flags.json');
  await writeFile(flagsFile, JSON.stringify({ flags: { coach_enabled: { enabled: false } } }));
  const config = loadServiceConfig({
    ...testEnv({ service: 'profile-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 4 }),
    FLAGS_SOURCE: 'file',
    FLAGS_FILE: flagsFile,
    FLAGS_POLL_SECONDS: '1',
  });
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  flags = await createFeatureFlags(config, { FEATURE_SETTINGS_V1: 'false' });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier, flags)],
  }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  await rm(dir, { recursive: true, force: true });
});

const server = () => app.getHttpServer();
/** Staff tokens carry MFA in `amr`, as admin routes require (TC-SEC-3). */
const token = (groups: string[] = []) =>
  dev.mintAccessToken({ sub: randomUUID(), groups, amr: ['pwd', 'mfa'] });

describe('GET /v1/me/flags', () => {
  it('returns every flag, evaluated from the file with env defaults underneath', async () => {
    const res = await request(server())
      .get('/v1/me/flags')
      .set('authorization', `Bearer ${await token()}`)
      .expect(200);
    expect(Object.keys(res.body.flags).sort()).toEqual(Object.keys(catalogueDefaults()).sort());
    expect(res.body.flags).toMatchObject({
      coach_enabled: false,
      settings_v1: false,
      coach_v1: true,
    });
  });

  it('follows a change to the file within the poll interval', async () => {
    await writeFile(flagsFile, JSON.stringify({ flags: { coach_enabled: { enabled: true } } }));
    await new Promise((r) => setTimeout(r, 1300));
    const res = await request(server())
      .get('/v1/me/flags')
      .set('authorization', `Bearer ${await token()}`)
      .expect(200);
    expect(res.body.flags.coach_enabled).toBe(true);
  });

  it('needs a token', async () => {
    await request(server()).get('/v1/me/flags').expect(401);
  });
});

describe('/v1/admin/flags', () => {
  it('lets admins set and clear a rule, which the file and the apps see', async () => {
    const admin = await token(['owner']);
    const put = await request(server())
      .put('/v1/admin/flags/meal_plans_v1')
      .set('authorization', `Bearer ${admin}`)
      .send({ enabled: false })
      .expect(200);
    expect(put.body).toEqual({ enabled: false });
    expect(JSON.parse(await readFile(flagsFile, 'utf8')).flags.meal_plans_v1).toEqual({
      enabled: false,
    });

    const listed = await request(server())
      .get('/v1/admin/flags')
      .set('authorization', `Bearer ${admin}`)
      .expect(200);
    expect(listed.body.writable).toBe(true);
    expect(listed.body.document.flags.meal_plans_v1).toEqual({ enabled: false });
    expect(listed.body.catalogue.meal_plans_v1.default).toBe(true);

    const mine = await request(server())
      .get('/v1/me/flags')
      .set('authorization', `Bearer ${await token()}`)
      .expect(200);
    expect(mine.body.flags.meal_plans_v1).toBe(false);

    await request(server())
      .delete('/v1/admin/flags/meal_plans_v1')
      .set('authorization', `Bearer ${admin}`)
      .expect(204);
    expect(flags.isEnabled('meal_plans_v1')).toBe(true);
  });

  it('refuses non-admins, unknown flags and bad rules', async () => {
    await request(server())
      .put('/v1/admin/flags/coach_v1')
      .set('authorization', `Bearer ${await token(['content_editor'])}`)
      .send({ enabled: false })
      .expect(403);
    await request(server())
      .get('/v1/admin/flags')
      .set('authorization', `Bearer ${await token()}`)
      .expect(403);
    const admin = await token(['owner']);
    await request(server())
      .put('/v1/admin/flags/not_a_flag')
      .set('authorization', `Bearer ${admin}`)
      .send({ enabled: false })
      .expect(404);
    await request(server())
      .put('/v1/admin/flags/coach_v1')
      .set('authorization', `Bearer ${admin}`)
      .send({ enabled: true, rolloutPercent: 150 })
      .expect(422);
  });
});
