# ADR-009: Service communication — internal REST plus outbox events on Redis Streams

Status: Proposed · 2026-10-11

## Context
Services must stay consistent without shared tables. Some interactions need an immediate answer (onboarding, coach tool reads, proposal apply); most are notifications of facts (a workout was completed, a meal was logged). The sibling project already publishes events over Redis.

## Options Considered
1. Synchronous REST everywhere.
2. Kafka (Amazon MSK) for events.
3. Amazon SNS + SQS.
4. Transactional outbox → Redis Streams with consumer groups, plus internal REST for the few synchronous needs.

## Decision
Option 4.
- **Outbox**: every state change and its event are written in one DB transaction (`OutboxEvent`); a relay in each service publishes to Redis Streams (`aura.<EventType>.v<n>`), retrying until acknowledged.
- **Consumers**: one consumer group per service per stream; handlers are idempotent (`ProcessedEvent(eventId)`), retried with backoff, and moved to a dead-letter stream after 5 attempts with an alert.
- **Envelope**: `{ id, type, version, occurredAt, producer, userId?, traceparent, data }`; schemas in `packages/contracts/events`, backward-compatible changes only within a version.
- **Sync calls**: `/internal/v1/*` REST with service JWTs, 2 s timeouts, circuit breakers (`opossum`), idempotency keys on writes.
- ElastiCache Redis with AOF persistence and Multi-AZ replica; stream retention 7 days (`MAXLEN ~` trimming) so a consumer can be replayed after an outage.

## Consequences
+ Reuses Redis already needed for cache and BullMQ; low cost and familiar to the owner.
+ Outbox guarantees no event is lost or sent for a rolled-back write.
− Redis Streams have weaker durability and tooling than Kafka. Migration path: the bus is behind a `EventBus` port in `service-kit`, so moving to MSK or SNS/SQS changes only the adapter.

## Alternatives Rejected
REST everywhere (tight coupling, cascading failures); Kafka now (cost and operations heavy for MVP volume); SNS/SQS (good option, but adds a second messaging system next to Redis for little MVP benefit).
