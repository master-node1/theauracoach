import { randomUUID } from 'node:crypto';
import {
  eventEnvelopeSchema,
  eventKey,
  isKnownEvent,
  parseEventData,
  type EventData,
  type EventEnvelope,
  type EventKey,
  type ServiceName,
} from '@aura/contracts';
import type { SqlExecutor } from './sql';

type TypeOf<K extends EventKey> = K extends `${infer T}@${string}` ? T : never;

/**
 * Writes an event to the outbox inside the caller's transaction, so the event exists if and only if
 * the state change it describes was committed (ADR-009). The relay publishes it afterwards.
 */
export async function writeOutbox<K extends EventKey>(
  tx: SqlExecutor,
  input: {
    producer: ServiceName;
    key: K;
    userId: string | null;
    data: EventData<K>;
    traceparent?: string | null;
    now?: Date;
  },
): Promise<EventEnvelope<EventData<K>>> {
  const [type, versionText] = input.key.split('@') as [TypeOf<K>, string];
  const version = Number(versionText);
  if (!isKnownEvent(eventKey(type, version))) throw new Error(`Unknown event ${input.key}`);
  const data = parseEventData(input.key, input.data);
  const envelope = eventEnvelopeSchema.parse({
    id: randomUUID(),
    type,
    version,
    occurredAt: (input.now ?? new Date()).toISOString(),
    producer: input.producer,
    userId: input.userId,
    traceparent: input.traceparent ?? null,
    data,
  }) as EventEnvelope<EventData<K>>;

  await tx.$executeRawUnsafe(
    `INSERT INTO "OutboxEvent" ("id", "type", "version", "userId", "payload", "traceparent")
     VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb, $6)`,
    envelope.id,
    envelope.type,
    envelope.version,
    envelope.userId,
    JSON.stringify(envelope),
    envelope.traceparent,
  );
  return envelope;
}
