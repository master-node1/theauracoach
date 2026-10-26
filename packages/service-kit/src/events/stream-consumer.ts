import {
  deadLetterKey,
  eventEnvelopeSchema,
  eventKey,
  isKnownEvent,
  parseEventData,
  streamKey,
  type EventData,
  type EventEnvelope,
  type EventKey,
  type ServiceName,
} from '@aura/contracts';
import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import type { Redis } from 'ioredis';
import { eventMetrics } from '../telemetry/metrics';
import { contextFromTraceparent, tracer } from '../telemetry/trace-context';
import type { SqlDatabase, SqlExecutor } from './sql';

export interface Subscription<K extends EventKey = EventKey> {
  key: K;
  /** Runs inside the same transaction that records the event as processed. */
  handle(event: EventEnvelope<EventData<K>>, tx: SqlExecutor): Promise<void>;
}

/**
 * Declares a handler. `Tx` lets a service type the transaction as its own Prisma transaction client;
 * the consumer passes whatever its database's $transaction provides.
 */
export function subscribe<K extends EventKey, Tx extends SqlExecutor = SqlExecutor>(
  key: K,
  handle: (event: EventEnvelope<EventData<K>>, tx: Tx) => Promise<void>,
): Subscription<K> {
  return { key, handle: (event, tx) => handle(event, tx as Tx) };
}

export interface StreamConsumerOptions {
  group: ServiceName;
  consumerName: string;
  subscriptions: Subscription[];
  blockMs?: number;
  batchSize?: number;
  /** Deliveries after which an entry moves to the dead-letter stream (platform LLD §4.2: 5). */
  maxDeliveries?: number;
  /** Pending entries idle this long are reclaimed from crashed consumers (60 s). */
  reclaimIdleMs?: number;
  logger?: { warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
}

export type HandleOutcome = 'processed' | 'duplicate' | 'failed' | 'dead-lettered';

type StreamEntry = [id: string, fields: string[]];

/**
 * Consumer-group reader for Redis Streams with exactly-once effects per service:
 * each event id is recorded in `ProcessedEvent` in the same transaction as the handler's writes,
 * and only then acknowledged. Failures stay pending and are retried; poison events go to the DLQ.
 * Each event is handled in a consumer span that continues the producer's trace (envelope `traceparent`).
 */
export class StreamConsumer {
  private running = false;
  private readonly byStream = new Map<string, Subscription>();
  private readonly maxDeliveries: number;
  private readonly reclaimIdleMs: number;

  constructor(
    private readonly db: SqlDatabase,
    private readonly redis: Redis,
    private readonly options: StreamConsumerOptions,
  ) {
    for (const sub of options.subscriptions) {
      const [type, version] = sub.key.split('@') as [string, string];
      this.byStream.set(streamKey(type, Number(version)), sub);
    }
    this.maxDeliveries = options.maxDeliveries ?? 5;
    this.reclaimIdleMs = options.reclaimIdleMs ?? 60_000;
  }

  get streams(): string[] {
    return [...this.byStream.keys()];
  }

  /** Creates consumer groups. A new group starts from the oldest retained entry, so new consumers can backfill. */
  async ensureGroups(): Promise<void> {
    for (const stream of this.streams) {
      try {
        await this.redis.xgroup('CREATE', stream, this.options.group, '0', 'MKSTREAM');
      } catch (err) {
        if (!(err instanceof Error && err.message.includes('BUSYGROUP'))) throw err;
      }
    }
  }

  /** Reads and handles one batch of new entries. Returns the outcomes (for tests and metrics). */
  async pollOnce(blockMs = this.options.blockMs ?? 2000): Promise<HandleOutcome[]> {
    if (this.streams.length === 0) return [];
    const res = (await this.redis.xreadgroup(
      'GROUP',
      this.options.group,
      this.options.consumerName,
      'COUNT',
      this.options.batchSize ?? 20,
      'BLOCK',
      blockMs,
      'STREAMS',
      ...this.streams,
      ...this.streams.map(() => '>'),
    )) as [stream: string, entries: StreamEntry[]][] | null;
    const outcomes: HandleOutcome[] = [];
    for (const [stream, entries] of res ?? []) {
      for (const [id, fields] of entries) outcomes.push(await this.handleEntry(stream, id, fields));
    }
    return outcomes;
  }

  /** Retries entries left pending by failures or crashed consumers; dead-letters those over the limit. */
  async reclaimOnce(): Promise<HandleOutcome[]> {
    const outcomes: HandleOutcome[] = [];
    for (const stream of this.streams) {
      const pending = (await this.redis.xpending(
        stream,
        this.options.group,
        'IDLE',
        this.reclaimIdleMs,
        '-',
        '+',
        50,
      )) as [id: string, consumer: string, idleMs: number, deliveries: number][];
      for (const [id, , , deliveries] of pending) {
        const claimed = (await this.redis.xclaim(
          stream,
          this.options.group,
          this.options.consumerName,
          this.reclaimIdleMs,
          id,
        )) as StreamEntry[];
        const entry = claimed[0];
        if (!entry) continue; // another consumer claimed it first, or it was trimmed
        if (deliveries >= this.maxDeliveries) {
          await this.deadLetter(
            stream,
            entry[0],
            entry[1],
            `exceeded ${this.maxDeliveries} deliveries`,
          );
          outcomes.push('dead-lettered');
        } else {
          outcomes.push(await this.handleEntry(stream, entry[0], entry[1]));
        }
      }
    }
    return outcomes;
  }

  async handleEntry(stream: string, id: string, fields: string[]): Promise<HandleOutcome> {
    const sub = this.byStream.get(stream);
    const raw = fieldValue(fields, 'event');
    let envelope: EventEnvelope;
    let data: unknown;
    try {
      envelope = eventEnvelopeSchema.parse(JSON.parse(raw ?? 'null')) as EventEnvelope;
      const key = eventKey(envelope.type, envelope.version);
      if (!sub || !isKnownEvent(key) || key !== sub.key) throw new Error(`Unexpected event ${key}`);
      data = parseEventData(key, envelope.data);
    } catch (err) {
      // Malformed events can never succeed: dead-letter at once instead of retrying.
      await this.deadLetter(
        stream,
        id,
        fields,
        err instanceof Error ? err.message : 'invalid event',
      );
      return 'dead-lettered';
    }

    return tracer.startActiveSpan(
      `process ${stream}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'redis',
          'messaging.operation.type': 'process',
          'messaging.destination.name': stream,
          'messaging.consumer.group.name': this.options.group,
          'messaging.message.id': envelope.id,
        },
      },
      contextFromTraceparent(envelope.traceparent),
      async (span) => {
        const outcome = await this.process(stream, id, envelope, data, sub);
        span.setAttribute('aura.event.outcome', outcome);
        if (outcome === 'failed') span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        eventMetrics.consumed.add(1, {
          'aura.event.type': envelope.type,
          'aura.event.outcome': outcome,
        });
        return outcome;
      },
    );
  }

  private async process(
    stream: string,
    id: string,
    envelope: EventEnvelope,
    data: unknown,
    sub: Subscription,
  ): Promise<HandleOutcome> {
    try {
      const processed = await this.db.$transaction(async (tx) => {
        const inserted = await tx.$executeRawUnsafe(
          `INSERT INTO "ProcessedEvent" ("eventId", "type") VALUES ($1, $2) ON CONFLICT ("eventId") DO NOTHING`,
          envelope.id,
          envelope.type,
        );
        if (inserted === 0) return false;
        await sub.handle({ ...envelope, data } as EventEnvelope<never>, tx);
        return true;
      });
      await this.redis.xack(stream, this.options.group, id);
      return processed ? 'processed' : 'duplicate';
    } catch (err) {
      trace.getActiveSpan()?.recordException(err as Error);
      this.options.logger?.warn(
        { err, stream, entryId: id, eventId: envelope.id },
        'Event handler failed',
      );
      return 'failed';
    }
  }

  private async deadLetter(
    stream: string,
    id: string,
    fields: string[],
    reason: string,
  ): Promise<void> {
    await this.redis.xadd(
      deadLetterKey(this.options.group),
      '*',
      'stream',
      stream,
      'entryId',
      id,
      'reason',
      reason.slice(0, 500),
      'event',
      fieldValue(fields, 'event') ?? '',
    );
    await this.redis.xack(stream, this.options.group, id);
    eventMetrics.consumed.add(1, { 'aura.event.outcome': 'dead-lettered' });
    this.options.logger?.error({ stream, entryId: id, reason }, 'Event dead-lettered');
  }

  /** Runs read and reclaim loops until stop() is called. */
  async run(): Promise<void> {
    // Polling is not traced (blocking reads every few seconds); handleEntry starts its own spans.
    return context.with(suppressTracing(ROOT_CONTEXT), () => this.loop());
  }

  private async loop(): Promise<void> {
    this.running = true;
    await this.ensureGroups();
    let lastReclaim = 0;
    while (this.running) {
      try {
        await this.pollOnce();
        if (Date.now() - lastReclaim > this.reclaimIdleMs / 2) {
          lastReclaim = Date.now();
          await this.reclaimOnce();
        }
      } catch (err) {
        if (!this.running) break; // the connection was closed by stop()
        this.options.logger?.error({ err }, 'Stream consumer loop error');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}

function fieldValue(fields: string[], name: string): string | undefined {
  for (let i = 0; i < fields.length - 1; i += 2) if (fields[i] === name) return fields[i + 1];
  return undefined;
}
