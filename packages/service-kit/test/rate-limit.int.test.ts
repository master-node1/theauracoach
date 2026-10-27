import { Controller, Get, INestApplication, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createDevIssuer, DEV_CLIENT_ID, type DevIssuer } from '@aura/dev-auth';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthGuard,
  configureHttpApp,
  HealthController,
  HealthRegistry,
  InternalOnly,
  INTERNAL_TOKEN_HEADER,
  mintServiceToken,
  ProblemDetailsFilter,
  Public,
  RateLimit,
  RateLimiter,
  RateLimitGuard,
  REDIS,
  SERVICE_KIT_CONFIG,
  UserTokenVerifier,
} from '../src';

/** Needs Redis: TEST_REDIS_URL. CI provides it as a service container. */
const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl) throw new Error('TEST_REDIS_URL is required');

const secret = 'r'.repeat(40);
const WINDOW = 2;

@Controller()
class LimitedController {
  @Public()
  @Get('v1/exercises')
  library() {
    return { ok: true };
  }

  @Get('v1/me')
  me() {
    return { ok: true };
  }

  @RateLimit({ name: 'test-search', scope: 'user', limit: 3, windowSeconds: WINDOW })
  @Get('v1/foods')
  search() {
    return { ok: true };
  }

  @InternalOnly('coach-service')
  @Post('internal/v1/thing')
  internal() {
    return { ok: true };
  }
}

let dev: DevIssuer;
let app: INestApplication;
let redis: Redis;

beforeAll(async () => {
  dev = await createDevIssuer();
  // Its own db: events-tracing.int.test.ts flushes db 14 while files run in parallel.
  redis = new Redis(redisUrl, { db: 13 });
  @Module({
    controllers: [LimitedController, HealthController],
    providers: [
      {
        provide: SERVICE_KIT_CONFIG,
        useValue: {
          SERVICE_NAME: 'nutrition-service',
          INTERNAL_TOKEN_SECRET: secret,
          RATE_LIMIT_ENABLED: true,
          RATE_LIMIT_USER_PER_MINUTE: 5,
          RATE_LIMIT_IP_PER_MINUTE: 8,
        },
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
      { provide: REDIS, useValue: redis },
      HealthRegistry,
      { provide: APP_GUARD, useClass: AuthGuard },
      { provide: APP_GUARD, useClass: RateLimitGuard },
      { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    ],
  })
  class TestModule {}
  const ref = await Test.createTestingModule({ imports: [TestModule] }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
});

beforeEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
});

const server = () => app.getHttpServer();
/** GETs `path` as a user and asserts the status (a supertest request is thenable, so no helper can return one). */
const asUser = async (path: string, status: number, sub = randomUUID()) =>
  request(server())
    .get(path)
    .set('authorization', `Bearer ${await dev.mintAccessToken({ sub })}`)
    .expect(status);

describe('RateLimitGuard', () => {
  it('returns a 429 problem with Retry-After over a route limit, then resets after the window', async () => {
    const sub = randomUUID();
    const token = await dev.mintAccessToken({ sub });
    const search = () => request(server()).get('/v1/foods').set('authorization', `Bearer ${token}`);
    for (let i = 0; i < 3; i++) await search().expect(200);

    const limited = await search().expect(429);
    expect(limited.headers['content-type']).toContain('application/problem+json');
    expect(limited.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(WINDOW);

    // Another user has their own bucket.
    await asUser('/v1/foods', 200);

    await new Promise((r) => setTimeout(r, retryAfter * 1000 + 50));
    await search().expect(200);
  });

  it('applies the general per-user limit, and refused requests do not count', async () => {
    const sub = randomUUID();
    for (let i = 0; i < 5; i++) await asUser('/v1/me', 200, sub);
    await asUser('/v1/me', 429, sub);
    await asUser('/v1/me', 429, sub);
    // A route limit does not get charged while the general limit refuses.
    expect(await redis.zcard(`rl:test-search:user:${sub}`)).toBe(0);
    expect(await redis.zcard(`rl:api:user:${sub}`)).toBe(5);
  });

  it('applies the per-IP limit to anonymous and signed-in callers alike', async () => {
    for (let i = 0; i < 8; i++) await request(server()).get('/v1/exercises').expect(200);
    await request(server()).get('/v1/exercises').expect(429);
    await asUser('/v1/me', 429);
  });

  it('never limits health checks or internal routes', async () => {
    for (let i = 0; i < 12; i++) await request(server()).get('/health/live').expect(200);
    for (let i = 0; i < 12; i++) {
      const token = await mintServiceToken({
        secret,
        issuer: 'coach-service',
        audience: 'nutrition-service',
      });
      await request(server())
        .post('/internal/v1/thing')
        .set(INTERNAL_TOKEN_HEADER, token)
        .expect(201);
    }
  });
});

describe('RateLimiter', () => {
  it('checks every bucket before charging any', async () => {
    const limiter = new RateLimiter(redis);
    const tight = { key: 'rl:t:tight', limit: 1, windowSeconds: 60 };
    const loose = { key: 'rl:t:loose', limit: 10, windowSeconds: 60 };
    expect(await limiter.hit([tight, loose])).toEqual({ allowed: true });
    const refused = await limiter.hit([tight, loose]);
    expect(refused.allowed).toBe(false);
    expect(await redis.zcard('rl:t:loose')).toBe(1);
    expect(await redis.pttl('rl:t:loose')).toBeGreaterThan(59_000);
  });

  it('counts a day window and reports the wait until a slot frees', async () => {
    const limiter = new RateLimiter(redis);
    const day = { key: 'rl:t:day', limit: 2, windowSeconds: 86_400 };
    await limiter.hit([day]);
    await limiter.hit([day]);
    const refused = await limiter.hit([day]);
    expect(refused).toMatchObject({ allowed: false });
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBeGreaterThan(86_000);
  });
});
