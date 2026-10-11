import { z } from 'zod';
import { SERVICE_NAMES } from '../services';

/** Envelope every event carries on the bus (platform LLD §4.1). */
export const eventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().regex(/^[A-Z][A-Za-z]+$/),
  version: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  producer: z.enum(SERVICE_NAMES),
  userId: z.uuid().nullable(),
  traceparent: z.string().max(55).nullable(),
  data: z.record(z.string(), z.unknown()),
});

export type EventEnvelope<TData = Record<string, unknown>> = Omit<
  z.infer<typeof eventEnvelopeSchema>,
  'data'
> & { data: TData };

/** Redis Stream key for an event type and version, e.g. `aura.UserRegistered.v1`. */
export function streamKey(type: string, version: number): string {
  return `aura.${type}.v${version}`;
}

/** Dead-letter stream for one consuming service. */
export function deadLetterKey(consumer: string): string {
  return `aura.dlq.${consumer}`;
}
