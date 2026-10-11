import { streamKey } from '@aura/contracts';
import type { Redis } from 'ioredis';
import type { SqlDatabase } from './sql';

export interface OutboxRelayOptions {
  batchSize?: number;
  intervalMs?: number;
  /** Stream entries older than this are trimmed on write (platform LLD §4.2: ~7 days). */
  retentionMs?: number;
  logger?: { warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
}

interface OutboxRow {
  id: string;
  type: string;
  version: number;
  payload: unknown;
}

/**
 * Publishes committed outbox rows to Redis Streams. Safe to run in several worker replicas:
 * rows are claimed with FOR UPDATE SKIP LOCKED. Delivery is at least once; consumers dedupe.
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly retentionMs: number;

  constructor(
    private readonly db: SqlDatabase,
    private readonly redis: Redis,
    private readonly options: OutboxRelayOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.intervalMs = options.intervalMs ?? 250;
    this.retentionMs = options.retentionMs ?? 7 * 24 * 3600 * 1000;
  }

  /** Publishes one batch. Returns how many events were published. */
  async runOnce(): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<OutboxRow[]>(
        `SELECT "id", "type", "version", "payload" FROM "OutboxEvent"
         WHERE "publishedAt" IS NULL
         ORDER BY "createdAt"
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        this.batchSize,
      );
      const published: string[] = [];
      for (const row of rows) {
        try {
          const payload =
            typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
          const minId = `${Date.now() - this.retentionMs}-0`;
          await this.redis.xadd(
            streamKey(row.type, row.version),
            'MINID',
            '~',
            minId,
            '*',
            'event',
            payload,
          );
          published.push(row.id);
        } catch (err) {
          this.options.logger?.error({ err, eventId: row.id }, 'Outbox publish failed');
          await tx.$executeRawUnsafe(
            `UPDATE "OutboxEvent" SET "attempts" = "attempts" + 1, "lastError" = $2 WHERE "id" = $1::uuid`,
            row.id,
            err instanceof Error ? err.message.slice(0, 500) : 'unknown',
          );
          break; // keep order: stop at the first failure and retry next tick
        }
      }
      if (published.length > 0) {
        await tx.$executeRawUnsafe(
          `UPDATE "OutboxEvent" SET "publishedAt" = now() WHERE "id" = ANY($1::uuid[])`,
          published,
        );
      }
      return published.length;
    });
  }

  /** Deletes published rows older than the retention window. Run from a daily job. */
  async purgePublished(olderThanMs = this.retentionMs): Promise<number> {
    return this.db.$executeRawUnsafe(
      `DELETE FROM "OutboxEvent" WHERE "publishedAt" IS NOT NULL AND "publishedAt" < now() - ($1::bigint * interval '1 millisecond')`,
      olderThanMs,
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      let published = 0;
      try {
        published = await this.runOnce();
      } catch (err) {
        this.options.logger?.error({ err }, 'Outbox relay tick failed');
      }
      if (this.running)
        this.timer = setTimeout(tick, published === this.batchSize ? 0 : this.intervalMs);
    };
    void tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
