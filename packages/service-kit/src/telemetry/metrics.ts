import { metrics } from '@opentelemetry/api';

/** Instruments are no-ops until the SDK is started, so these are safe to use everywhere. */
const meter = metrics.getMeter('@aura/service-kit');

export const eventMetrics = {
  published: meter.createCounter('aura.events.published', {
    description: 'Outbox events published to Redis Streams',
  }),
  consumed: meter.createCounter('aura.events.consumed', {
    description: 'Stream entries handled, by outcome (processed, duplicate, failed, dead-lettered)',
  }),
};

export { meter as serviceKitMeter };
