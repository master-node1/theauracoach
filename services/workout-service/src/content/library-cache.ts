import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS } from '@aura/service-kit';
import { createHash } from 'node:crypto';

/** The Redis commands the cache uses (ioredis satisfies it). */
export interface CacheRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
}

export interface Cached<T> {
  body: T;
  etag: string;
}

const GENERATION = 'workout:library:gen';
const TTL_SECONDS = 3600;

export function etagOf(body: unknown): string {
  return `"${createHash('sha1').update(JSON.stringify(body)).digest('base64url')}"`;
}

/**
 * Exercise library cache (workouts LLD §8): Redis, 1 h, with the response's ETag stored alongside.
 * Keys carry a generation number; invalidating bumps it, so every list and detail page goes stale
 * at once without scanning keys. A Redis failure only costs the cache: reads fall through to the
 * database.
 */
@Injectable()
export class LibraryCache {
  private readonly logger = new Logger(LibraryCache.name);

  constructor(@Inject(REDIS) private readonly redis: CacheRedis) {}

  async read<T>(key: string, load: () => Promise<T>): Promise<Cached<T>> {
    let full: string | null = null;
    try {
      full = `workout:library:${(await this.redis.get(GENERATION)) ?? '0'}:${key}`;
      const hit = await this.redis.get(full);
      if (hit) return JSON.parse(hit) as Cached<T>;
    } catch (err) {
      this.logger.warn({ err, msg: 'Library cache read failed' });
    }
    const body = await load();
    const entry = { body, etag: etagOf(body) };
    if (full) {
      await this.redis
        .set(full, JSON.stringify(entry), 'EX', TTL_SECONDS)
        .catch((err: unknown) => this.logger.warn({ err, msg: 'Library cache write failed' }));
    }
    return entry;
  }

  async invalidate(): Promise<void> {
    await this.redis.incr(GENERATION);
  }
}
