import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { hostname } from 'node:os';
import type { BaseConfig } from '../config/config';
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
    this.logger.log(
      `Event worker started: relay on, ${this.subscriptions.length} subscription(s) ${this.consumer?.streams.join(', ') ?? ''}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.relay?.stop();
    this.consumer?.stop();
    this.consumerRedis?.disconnect();
    await this.loop?.catch(() => undefined);
  }
}
