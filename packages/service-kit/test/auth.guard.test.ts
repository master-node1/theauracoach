import { Controller, Get, INestApplication, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createDevIssuer, DEV_CLIENT_ID, type DevIssuer } from '@aura/dev-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuthGuard,
  CallingService,
  CurrentUser,
  InternalOnly,
  INTERNAL_TOKEN_HEADER,
  MemorySessionRevocations,
  mintServiceToken,
  ProblemDetailsFilter,
  Public,
  SERVICE_KIT_CONFIG,
  SESSION_REVOCATIONS,
  UserTokenVerifier,
  type AuthenticatedUser,
  type ServiceCaller,
} from '../src';

const secret = 'i'.repeat(40);

@Controller()
class TestController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('v1/me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @InternalOnly('coach-service')
  @Post('internal/v1/thing')
  internal(@CallingService() caller: ServiceCaller) {
    return caller;
  }
}

let dev: DevIssuer;
let app: INestApplication;
const revocations = new MemorySessionRevocations();

beforeAll(async () => {
  dev = await createDevIssuer();
  @Module({
    controllers: [TestController],
    providers: [
      {
        provide: SERVICE_KIT_CONFIG,
        useValue: { SERVICE_NAME: 'workout-service', INTERNAL_TOKEN_SECRET: secret },
      },
      {
        provide: UserTokenVerifier,
        useValue: new UserTokenVerifier({
          jwksUrl: 'http://unused',
          issuer: dev.issuer,
          clientIds: [DEV_CLIENT_ID],
          keySource: dev.keySource,
        }),
      },
      { provide: SESSION_REVOCATIONS, useValue: revocations },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  })
  class TestModule {}
  const ref = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = ref.createNestApplication();
  await app.init();
});

afterAll(() => app.close());

describe('AuthGuard', () => {
  it('lets public routes through without a token', async () => {
    await request(app.getHttpServer()).get('/open').expect(200, { ok: true });
  });

  it('returns a 401 problem without a token', async () => {
    const res = await request(app.getHttpServer()).get('/v1/me').expect(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('accepts a valid access token and exposes the user', async () => {
    const sub = '0b6f5c1e-8f0a-4b8e-9c47-3d2a1e5f7a90';
    const token = await dev.mintAccessToken({ sub, email: 'a@example.com', groups: ['trainer'] });
    const res = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({
      userId: sub,
      email: 'a@example.com',
      groups: ['trainer'],
      clientId: DEV_CLIENT_ID,
      issuedAt: expect.any(Number),
    });
  });

  it('rejects tokens issued before the user signed out of all devices', async () => {
    const sub = '6a3e1f0c-2b4d-4e8f-9a1b-7c5d3e2f1a00';
    const other = '6a3e1f0c-2b4d-4e8f-9a1b-7c5d3e2f1a01';
    const old = await dev.mintAccessToken({ sub });
    const unaffected = await dev.mintAccessToken({ sub: other });
    await revocations.revokeAll(sub, Math.floor(Date.now() / 1000));
    const get = (token: string) =>
      request(app.getHttpServer()).get('/v1/me').set('authorization', `Bearer ${token}`);
    await get(old).expect(401);
    await get(unaffected).expect(200);
    // A later cut-off never moves back.
    await revocations.revokeAll(sub, 1);
    expect(await revocations.revokedBefore(sub)).toBeGreaterThan(1);
    await new Promise((r) => setTimeout(r, 1100));
    await get(await dev.mintAccessToken({ sub })).expect(200);
  });

  it('rejects ID tokens, unknown clients, expired tokens and non-UUID subjects', async () => {
    for (const token of [
      await dev.mintAccessToken({ tokenUse: 'id' }),
      await dev.mintAccessToken({ clientId: 'someone-else' }),
      await dev.mintAccessToken({ expiresIn: '-1m' }),
      await dev.mintAccessToken({ sub: 'not-a-uuid' }),
    ]) {
      await request(app.getHttpServer())
        .get('/v1/me')
        .set('authorization', `Bearer ${token}`)
        .expect(401);
    }
  });

  it('rejects tokens from another issuer', async () => {
    const other = await createDevIssuer('http://evil.example');
    const token = await other.mintAccessToken({});
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('accepts a service token from an allowed caller on internal routes', async () => {
    const token = await mintServiceToken({
      secret,
      issuer: 'coach-service',
      audience: 'workout-service',
      subUser: 'u-1',
    });
    const res = await request(app.getHttpServer())
      .post('/internal/v1/thing')
      .set(INTERNAL_TOKEN_HEADER, token)
      .expect(201);
    expect(res.body).toEqual({ service: 'coach-service', subUser: 'u-1' });
  });

  it('forbids callers not on the route list', async () => {
    const token = await mintServiceToken({
      secret,
      issuer: 'nutrition-service',
      audience: 'workout-service',
    });
    const res = await request(app.getHttpServer())
      .post('/internal/v1/thing')
      .set(INTERNAL_TOKEN_HEADER, token)
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('never accepts a user token on an internal route', async () => {
    const token = await dev.mintAccessToken({});
    await request(app.getHttpServer())
      .post('/internal/v1/thing')
      .set('authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('renders unknown routes as a 404 problem', async () => {
    const token = await dev.mintAccessToken({});
    const res = await request(app.getHttpServer())
      .get('/v1/nope')
      .set('authorization', `Bearer ${token}`)
      .expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', instance: '/v1/nope' });
  });
});
