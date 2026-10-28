import { Controller, Delete, Get, INestApplication, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { ConsentPurpose } from '@aura/contracts';
import { createDevIssuer, DEV_CLIENT_ID, type DevIssuer } from '@aura/dev-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminMfaGuard,
  AuthGuard,
  CONSENT_STATE,
  ConsentGuard,
  describeRoutes,
  guardMatrixViolations,
  InternalOnly,
  Permissions,
  PermissionsGuard,
  ProblemDetailsFilter,
  Public,
  RequiresConsent,
  SERVICE_KIT_CONFIG,
  UserTokenVerifier,
  type ConsentStateReader,
} from '../src';

@Controller('v1/admin/things')
class AdminController {
  @Permissions('exercise:publish')
  @Post(':id/publish')
  publish() {
    return { ok: true };
  }

  // Forgot @Permissions: must fail closed.
  @Delete(':id')
  remove() {
    return { ok: true };
  }
}

@Controller('v1/coach')
class CoachController {
  @RequiresConsent('AI_COACH')
  @Get('conversations')
  list() {
    return [];
  }

  @Get('limits')
  limits() {
    return { ok: true };
  }
}

/** The replica a real service builds from ConsentChanged events. */
class MemoryConsents implements ConsentStateReader {
  readonly granted = new Set<string>();
  async isGranted(userId: string, purpose: ConsentPurpose) {
    return this.granted.has(`${userId}:${purpose}`);
  }
}

const consents = new MemoryConsents();
let dev: DevIssuer;
let app: INestApplication;
const USER = '0b6f5c1e-8f0a-4b8e-9c47-3d2a1e5f7a90';

beforeAll(async () => {
  dev = await createDevIssuer();
  @Module({
    controllers: [AdminController, CoachController],
    providers: [
      {
        provide: SERVICE_KIT_CONFIG,
        useValue: { SERVICE_NAME: 'coach-service', INTERNAL_TOKEN_SECRET: 'i'.repeat(40) },
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
      { provide: CONSENT_STATE, useValue: consents },
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_GUARD, useClass: AdminMfaGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
      { provide: APP_GUARD, useClass: ConsentGuard },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  })
  class TestModule {}
  const ref = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = ref.createNestApplication();
  await app.init();
});

afterAll(() => app.close());

const token = (groups: string[], amr: string[]) =>
  dev.mintAccessToken({ sub: USER, email: 'staff@example.com', groups, amr });

const publish = async (groups: string[], amr: string[]) =>
  request(app.getHttpServer())
    .post('/v1/admin/things/42/publish')
    .set('authorization', `Bearer ${await token(groups, amr)}`);

describe('admin routes (TC-SEC-3)', () => {
  it('refuses staff without MFA with 403 MFA_REQUIRED', async () => {
    const res = await publish(['content_reviewer'], ['pwd']);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'MFA_REQUIRED' });
  });

  it('refuses staff with MFA but without the permission with 403 FORBIDDEN', async () => {
    const res = await publish(['nutrition_reviewer'], ['pwd', 'mfa']);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('lets staff with MFA and the permission through', async () => {
    await publish(['content_reviewer'], ['pwd', 'mfa']).then((r) => expect(r.status).toBe(201));
    await publish(['owner'], ['pwd', 'otp']).then((r) => expect(r.status).toBe(201));
  });

  it('answers ordinary users FORBIDDEN, not MFA_REQUIRED, so admin routes leak nothing', async () => {
    const res = await publish([], ['pwd']);
    expect(res.body).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('refuses an admin route that declares no permissions, even for owners', async () => {
    const res = await request(app.getHttpServer())
      .delete('/v1/admin/things/42')
      .set('authorization', `Bearer ${await token(['owner'], ['pwd', 'mfa'])}`);
    expect(res.body).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('ConsentGuard (TC-PRV-4)', () => {
  const list = async () =>
    request(app.getHttpServer())
      .get('/v1/coach/conversations')
      .set('authorization', `Bearer ${await token([], ['pwd'])}`);

  it('answers 403 CONSENT_REQUIRED with the purpose until consent is granted', async () => {
    const denied = await list();
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'CONSENT_REQUIRED', purpose: 'AI_COACH' });
    expect(denied.headers['content-type']).toContain('application/problem+json');

    consents.granted.add(`${USER}:AI_COACH`);
    await list().then((r) => expect(r.status).toBe(200));
    consents.granted.delete(`${USER}:AI_COACH`);
    await list().then((r) => expect(r.status).toBe(403));
  });

  it('leaves routes without @RequiresConsent alone', async () => {
    await request(app.getHttpServer())
      .get('/v1/coach/limits')
      .set('authorization', `Bearer ${await token([], ['pwd'])}`)
      .expect(200);
  });
});

describe('guard matrix', () => {
  it('reads every route and its guards from metadata', () => {
    expect(describeRoutes(app)).toEqual([
      expect.objectContaining({ route: 'DELETE /v1/admin/things/:id', permissions: [] }),
      expect.objectContaining({ route: 'GET /v1/coach/conversations', consent: 'AI_COACH' }),
      expect.objectContaining({ route: 'GET /v1/coach/limits', access: 'user' }),
      expect.objectContaining({
        route: 'POST /v1/admin/things/:id/publish',
        access: 'user',
        permissions: ['exercise:publish'],
      }),
    ]);
  });

  it('flags admin routes without permissions', () => {
    expect(guardMatrixViolations(describeRoutes(app), { publicRoutes: [] })).toEqual([
      'DELETE /v1/admin/things/:id: is an admin route without @Permissions',
    ]);
  });

  it('fails when an unreviewed public route or a misplaced internal route is added', async () => {
    @Controller()
    class Careless {
      @Public()
      @Get('v1/new-thing')
      open() {}

      @Get('internal/v1/forgot')
      forgot() {}

      @InternalOnly('coach-service')
      @Get('v1/odd')
      odd() {}

      @Public()
      @InternalOnly('coach-service')
      @Permissions('audit:read')
      @Get('internal/v1/both')
      both() {}
    }
    @Module({ controllers: [Careless] })
    class CarelessModule {}
    const ref = await Test.createTestingModule({ imports: [CarelessModule] }).compile();
    expect(
      guardMatrixViolations(describeRoutes(ref), { publicRoutes: ['GET /health/live'] }),
    ).toEqual([
      'GET /internal/v1/both: is both @Public and @InternalOnly',
      'GET /internal/v1/both: has @Permissions but no user token to check them against',
      'GET /internal/v1/forgot: is under /internal but not @InternalOnly',
      'GET /v1/new-thing: is @Public but not in the reviewed list of public routes',
      'GET /v1/odd: is @InternalOnly but not under /internal/v1',
      'GET /health/live: listed as public but no such public route exists',
    ]);
    await ref.close();
  });
});
