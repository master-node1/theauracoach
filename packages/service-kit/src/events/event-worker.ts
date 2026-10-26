import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { deadLetterKey } from '@aura/contracts';
import { context, ROOT_CONTEXT, type BatchObservableCallback } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import type { Redis } from 'ioredis';
import { hostname } from 'node:os';
import type { BaseConfig } from '../config/config';
import { serviceKitMeter } from '../telemetry/metrics';
import { REDIS, SERVICE_KIT_CONFIG } from '../tokens';
import { OutboxRelay } from './outbox-relay';
import type { SqlDatabase } from './sql';
import { StreamConsumer, type Subscription } from './stream-consumer';

export const EVENT_DATABASE = Symbol('EVENT_DATABASE');
export const EVENT_SUBSCRIPTIONS = Symbol('EVENT_SUBSCRIPTIONS');

/**
 * Runs in the worker deployment: publishes this service's outbox and consumes its subscriptions.
 * The consumer gets its own Redis connection because XREADGROUP BLOCK holds the connection.
 */
@Injectable()
export class EventWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventWorker.name);
  private relay?: OutboxRelay;
  private consumer?: StreamConsumer;
  private consumerRedis?: Redis;
  private loop?: Promise<void>;
  private readonly outboxPending = serviceKitMeter.createObservableGauge('aura.outbox.pending', {
    description: 'Outbox rows not yet published',
  });
  private readonly outboxAge = serviceKitMeter.createObservableGauge('aura.outbox.oldest_age', {
    description: 'Age of the oldest unpublished outbox row',
    unit: 's',
  });
  private readonly consumerLag = serviceKitMeter.createObservableGauge('aura.events.consumer.lag', {
    description: 'Stream entries not yet delivered to this service’s consumer group',
  });
  private readonly dlqLength = serviceKitMeter.createObservableGauge('aura.events.dlq.length', {
    description: 'Entries in this service’s dead-letter stream',
  });
  private readonly observe: BatchObservableCallback = (result) =>
    context.with(suppressTracing(ROOT_CONTEXT), () => this.collect(result));

  constructor(
    @Inject(EVENT_DATABASE) private readonly db: SqlDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: BaseConfig,
    @Inject(EVENT_SUBSCRIPTIONS) private readonly subscriptions: Subscription[],
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const logger = {
      warn: (obj: object, msg: string) => this.logger.warn({ ...obj, msg }),
      error: (obj: object, msg: string) => this.logger.error({ ...obj, msg }),
    };
    this.relay = new OutboxRelay(this.db, this.redis, { logger });
    this.relay.start();
    if (this.subscriptions.length > 0) {
      this.consumerRedis = this.redis.duplicate();
      this.consumer = new StreamConsumer(this.db, this.consumerRedis, {
        group: this.config.SERVICE_NAME,
        consumerName: `${hostname()}-${process.pid}`,
        subscriptions: this.subscriptions,
        logger,
      });
      this.loop = this.consumer.run();
    }
    serviceKitMeter.addBatchObservableCallback(this.observe, [
      this.outboxPending,
      this.outboxAge,
      this.consumerLag,
      this.dlqLength,
    ]);
    this.logger.log(
      `Event worker started: relay on, ${this.subscriptions.length} subscription(s) ${this.consumer?.streams.join(', ') ?? ''}`,
    );
  }

  /** Read by the metrics SDK on each export (60 s); never runs when telemetry is off. */
  private async collect(result: Parameters<BatchObservableCallback>[0]): Promise<void> {
    try {
      const [row] = await this.db.$queryRawUnsafe<{ pending: number; age: number | null }[]>(
        `SELECT count(*)::int AS "pending",
                EXTRACT(EPOCH FROM now() - min("createdAt"))::float8 AS "age"
         FROM "OutboxEvent" WHERE "publishedAt" IS NULL`,
      );
      result.observe(this.outboxPending, row?.pending ?? 0);
      result.observe(this.outboxAge, row?.age ?? 0);
      const group = this.config.SERVICE_NAME;
      for (const stream of this.consumer?.streams ?? []) {
        const groups = (await this.redis.xinfo('GROUPS', stream)) as unknown[][];
        const info = groups.map(pairs).find((g) => g.name === group);
        if (typeof info?.lag === 'number') result.observe(this.consumerLag, info.lag, { stream });
      }
      result.observe(this.dlqLength, await this.redis.xlen(deadLetterKey(group)));
    } catch (err) {
      this.logger.warn({ err, msg: 'Event metrics collection failed' });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    serviceKitMeter.removeBatchObservableCallback(this.observe, [
      this.outboxPending,
      this.outboxAge,
      this.consumerLag,
      this.dlqLength,
    ]);
    this.relay?.stop();
    this.consumer?.stop();
    this.consumerRedis?.disconnect();
    await this.loop?.catch(() => undefined);
  }
}

/** XINFO GROUPS returns flat [key, value, ...] arrays. */
function pairs(flat: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < flat.length - 1; i += 2) out[String(flat[i])] = flat[i + 1];
  return out;
}
