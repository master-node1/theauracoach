import type { Redis } from 'ioredis';

/**
 * "Sign out of all devices" (TAC-8, auth LLD §2). Cognito's GlobalSignOut stops the user's refresh
 * tokens, but access tokens are verified locally and would keep working until they expire, so the
 * API also records a per-user cut-off: access tokens issued at or before it are rejected by the
 * AuthGuard in every service. A cut-off covers tokens on devices the API has never seen, which a
 * deny-list of single token ids could not.
 */
export interface SessionRevocations {
  /** Epoch seconds; the user's tokens with `iat` at or before it are revoked. Null when none. */
  revokedBefore(userId: string): Promise<number | null>;
  /** Revokes every token issued up to `atSeconds`. */
  revokeAll(userId: string, atSeconds: number): Promise<void>;
}

export const SESSION_REVOCATIONS = Symbol('SESSION_REVOCATIONS');

/**
 * Cognito access tokens live at most a day, so a cut-off older than that can no longer match a
 * valid token and the key expires on its own.
 */
export const REVOCATION_TTL_SECONDS = 24 * 60 * 60;

const key = (userId: string) => `auth:revoked-before:${userId}`;

/** Shared through the Redis every service already uses, so one write reaches all of them. */
export class RedisSessionRevocations implements SessionRevocations {
  constructor(private readonly redis: Redis) {}

  async revokedBefore(userId: string): Promise<number | null> {
    const value = await this.redis.get(key(userId));
    return value === null ? null : Number(value);
  }

  async revokeAll(userId: string, atSeconds: number): Promise<void> {
    // Never move the cut-off backwards if two revocations race.
    const current = await this.revokedBefore(userId);
    const at = Math.max(atSeconds, current ?? 0);
    await this.redis.set(key(userId), String(at), 'EX', REVOCATION_TTL_SECONDS);
  }
}

/** For tests and tools without Redis. */
export class MemorySessionRevocations implements SessionRevocations {
  private readonly cutoffs = new Map<string, number>();

  async revokedBefore(userId: string): Promise<number | null> {
    return this.cutoffs.get(userId) ?? null;
  }

  async revokeAll(userId: string, atSeconds: number): Promise<void> {
    this.cutoffs.set(userId, Math.max(atSeconds, this.cutoffs.get(userId) ?? 0));
  }
}
