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
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';

let db: TestDatabase;
let app: INestApplication;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'audit');
  const dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'audit-service', databaseUrl: db.url, issuer: dev.issuer }),
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
  await db?.drop();
});

describe('audit-service', () => {
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
});
