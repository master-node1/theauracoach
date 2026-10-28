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
import { IdentityProviderError, type IdentityProvider } from '../src/identity/identity-provider';

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
const signedOut: string[] = [];
let failNext: string | null = null;

const identity: IdentityProvider = {
  async globalSignOut(token) {
    if (failNext) {
      const type = failNext;
      failNext = null;
      throw new IdentityProviderError(type);
    }
    signedOut.push(token);
  },
};

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'profile_sessions');
  dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'profile-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 5 }),
  );
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier, undefined, undefined, identity)],
  }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const me = (token: string) =>
  request(app.getHttpServer()).get('/v1/me').set('authorization', `Bearer ${token}`);
const revoke = (token: string) =>
  request(app.getHttpServer())
    .post('/v1/me/sessions/revoke')
    .set('authorization', `Bearer ${token}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('POST /v1/me/sessions/revoke', () => {
  it('signs out every device: unexpired access tokens get 401, new sign-ins work', async () => {
    const sub = randomUUID();
    const email = `revoke-${sub}@example.com`;
    const phone = await dev.mintAccessToken({ sub, email });
    const laptop = await dev.mintAccessToken({ sub, email, expiresIn: '1h' });
    const stranger = await dev.mintAccessToken({ sub: randomUUID(), email: 'x@example.com' });
    await me(phone).expect(200);
    await me(laptop).expect(200);

    await revoke(phone).expect(204);
    expect(signedOut).toContain(phone);

    // Both tokens are well within their expiry but no longer accepted (cut-off in Redis).
    for (const token of [phone, laptop]) {
      const res = await me(token).expect(401);
      expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    await me(stranger).expect(200);

    // Signing in again after the cut-off gives a working token.
    await sleep(1100);
    await me(await dev.mintAccessToken({ sub, email })).expect(200);
  });

  it('returns 503 when the identity provider cannot be reached, and holds the cut-off', async () => {
    const sub = randomUUID();
    const token = await dev.mintAccessToken({ sub, email: `fail-${sub}@example.com` });
    failNext = 'InternalErrorException';
    const res = await revoke(token).expect(503);
    expect(res.body).toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
    await me(token).expect(401);
  });

  it('treats a token Cognito already revoked as done', async () => {
    const sub = randomUUID();
    const token = await dev.mintAccessToken({ sub, email: `again-${sub}@example.com` });
    failNext = 'NotAuthorizedException';
    await revoke(token).expect(204);
  });

  it('needs a signed-in user', async () => {
    await request(app.getHttpServer()).post('/v1/me/sessions/revoke').expect(401);
  });
});
