import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { INTERNAL_CALLERS, type AuthenticatedUser } from '../auth/decorators';
import type { BaseConfig } from '../config/config';
import { ProblemException } from '../http/problem';
import { REDIS, SERVICE_KIT_CONFIG } from '../tokens';

export interface RateLimitRule {
  /** Bucket name. Routes that share a name share a counter, across services too. */
  name: string;
  /** `user` counts per signed-in user (per IP when there is none), `ip` per client address. */
  scope: 'user' | 'ip';
  limit: number;
  windowSeconds: number;
}

/** Route limits from security architecture §5. The general per-user and per-IP limits always apply. */
export const RATE_LIMITS = {
  search: { name: 'search', scope: 'user', limit: 60, windowSeconds: 60 },
  coachPerMinute: { name: 'coach-min', scope: 'user', limit: 10, windowSeconds: 60 },
  coachPerDay: { name: 'coach-day', scope: 'user', limit: 30, windowSeconds: 86_400 },
  uploadsPerDay: { name: 'uploads', scope: 'user', limit: 20, windowSeconds: 86_400 },
} as const satisfies Record<string, RateLimitRule>;

export const RATE_LIMIT_RULES = 'aura:rate-limits';
export const SKIP_RATE_LIMIT = 'aura:skip-rate-limit';

/** Adds route limits on top of the general ones, e.g. `@RateLimit(RATE_LIMITS.search)`. */
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_RULES, rules);

/** No limits at all: health checks. Internal routes are never limited. */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);

/**
 * Sliding-window log per key in a sorted set. Every bucket is checked before any is charged, so a
 * request refused by one limit does not use up another, and refused requests are not counted.
 * Time comes from Redis so every replica agrees. Returns {1, 0} or {0, msUntilASlotFrees}.
 */
const SLIDING_WINDOW_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local wait = 0
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[i * 2])
  local window = tonumber(ARGV[i * 2 + 1])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  local count = redis.call('ZCARD', key)
  if count >= limit then
    local oldest = redis.call('ZRANGE', key, count - limit, count - limit, 'WITHSCORES')
    local ms = tonumber(oldest[2]) + window - now
    if ms > wait then wait = ms end
  end
end
if wait > 0 then return {0, wait} end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, ARGV[1])
  redis.call('PEXPIRE', key, tonumber(ARGV[i * 2 + 1]))
end
return {1, 0}
`;

type RedisWithLimiter = Redis & {
  auraRateLimit(keys: number, ...args: (string | number)[]): Promise<[number, number]>;
};

export interface RateLimitBucket {
  key: string;
  limit: number;
  windowSeconds: number;
}

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class RateLimiter {
  private readonly redis: RedisWithLimiter;

  constructor(redis: Redis) {
    if (!('auraRateLimit' in redis)) {
      redis.defineCommand('auraRateLimit', { lua: SLIDING_WINDOW_LUA });
    }
    this.redis = redis as RedisWithLimiter;
  }

  async hit(buckets: RateLimitBucket[]): Promise<RateLimitResult> {
    if (buckets.length === 0) return { allowed: true };
    const args: (string | number)[] = [`${Date.now()}-${randomUUID()}`];
    for (const b of buckets) args.push(b.limit, b.windowSeconds * 1000);
    const [ok, waitMs] = await this.redis.auraRateLimit(
      buckets.length,
      ...buckets.map((b) => b.key),
      ...args,
    );
    if (ok === 1) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
  }
}

/**
 * Global guard, after AuthGuard: the general per-user and per-IP limits plus any `@RateLimit`
 * rules on the route. Over a limit the answer is 429 RATE_LIMITED with `Retry-After`. If Redis is
 * unreachable the request goes through (the gateway's per-IP limit still applies).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');
  private readonly limiter: RateLimiter;

  constructor(
    private readonly reflector: Reflector,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: BaseConfig,
    @Inject(REDIS) redis: Redis,
  ) {
    this.limiter = new RateLimiter(redis);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.RATE_LIMIT_ENABLED || context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, targets)) return true;
    if (this.reflector.getAllAndOverride(INTERNAL_CALLERS, targets)) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthenticatedUser }>();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const userId = req.user?.userId;

    const rules: RateLimitRule[] = [
      { name: 'api', scope: 'ip', limit: this.config.RATE_LIMIT_IP_PER_MINUTE, windowSeconds: 60 },
      ...(userId
        ? [
            {
              name: 'api',
              scope: 'user' as const,
              limit: this.config.RATE_LIMIT_USER_PER_MINUTE,
              windowSeconds: 60,
            },
          ]
        : []),
      ...this.reflector.getAllAndMerge<RateLimitRule[]>(RATE_LIMIT_RULES, targets),
    ];
    const buckets = rules.map((r) => {
      const subject = r.scope === 'user' && userId ? `user:${userId}` : `ip:${ip}`;
      return { key: `rl:${r.name}:${subject}`, limit: r.limit, windowSeconds: r.windowSeconds };
    });

    let result: RateLimitResult;
    try {
      result = await this.limiter.hit(buckets);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Rate limiter unavailable; allowing');
      return true;
    }
    if (result.allowed) return true;
    http.getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new ProblemException(
      HttpStatus.TOO_MANY_REQUESTS,
      'RATE_LIMITED',
      'Too many requests',
      `Try again in ${result.retryAfterSeconds} s.`,
    );
  }
}
