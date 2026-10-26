# Monitoring

Every service sends traces and metrics with OpenTelemetry, set up once in `packages/service-kit` ([TAC-5](https://harisireddi7776.atlassian.net/browse/TAC-5)). Logs stay JSON on stdout and carry the trace. This page covers what is collected, how to look at it locally, and the settings. Production exporters (Grafana Cloud, HLD §observability) come with the hosting work.

## What is collected

| Signal | Source | Notes |
|---|---|---|
| HTTP server spans | `@opentelemetry/instrumentation-http`, `-express`, `-nestjs-core` | Named by route, e.g. `GET /v1/me`. `/health/*` is not traced. The span carries `aura.request_id` (the `X-Request-Id`). |
| Service-to-service calls | `@opentelemetry/instrumentation-undici` (global `fetch`, used by `InternalClient`) | Sends `traceparent`, so the callee's span joins the caller's trace. |
| Database | `@prisma/instrumentation` | Operations, transactions and SQL queries; engine internals are dropped. |
| Redis | `@opentelemetry/instrumentation-ioredis` | Only inside a traced operation, so idle stream polling makes no traces. |
| Events | service-kit outbox and stream consumer | `writeOutbox` stores the active `traceparent` in the envelope. The relay adds a `send <stream>` producer span and the consumer a `process <stream>` consumer span to that same trace. The consumer span has `aura.event.outcome` and is marked as an error when the handler fails. |
| Logs | pino mixin in `loggerModule` | Every line inside a request or event handler has `traceId` and `spanId`. Redaction is unchanged. |

One sign-up therefore shows up as a single trace: `GET /v1/me` in profile-service → `send aura.UserRegistered.v1` in profile-service's worker → `process aura.UserRegistered.v1` in notification-service's worker.

The gateway (nginx) does not make spans. It passes a client's `traceparent` through unchanged and writes it next to the request id in its JSON access log. When there is none, the service starts the trace.

### Metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `http.server.request.duration` | histogram (s) | `http.route`, `http.request.method`, `http.response.status_code` | Request latency per route (from the HTTP instrumentation) |
| `aura.events.published` | counter | `aura.event.type` | Outbox events published to Redis Streams |
| `aura.events.consumed` | counter | `aura.event.type`, `aura.event.outcome` | Stream entries handled: `processed`, `duplicate`, `failed`, `dead-lettered` |
| `aura.outbox.pending` | gauge | | Outbox rows not yet published |
| `aura.outbox.oldest_age` | gauge (s) | | Age of the oldest unpublished row. It should stay under a second; if it grows, the relay is stuck |
| `aura.events.consumer.lag` | gauge | `stream` | Entries not yet delivered to this service's consumer group |
| `aura.events.dlq.length` | gauge | | Entries in this service's dead-letter stream. Anything above 0 needs a look |

The event gauges come from the worker deployment, and every metric has `service.name` and `aura.process.role` (`http` or `worker`). In Prometheus, dots become underscores and units become suffixes, e.g. `aura_outbox_oldest_age_seconds` and `aura_events_consumed_total`.

## Look at traces locally

```bash
pnpm stack:observability
```

This is `docker compose up` plus the `observability` profile, with `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-lgtm:4318` set for every service. The `otel-lgtm` container bundles an OpenTelemetry collector, Tempo, Prometheus, Loki and Grafana. Open Grafana at http://localhost:3300 (no login locally):

- **Traces:** Explore → Tempo → Search, filter by service name, or paste a `traceId` from a log line.
- **Metrics:** Explore → Prometheus, e.g. `sum by (service_name, aura_event_outcome) (rate(aura_events_consumed_total[5m]))`.

Plain `docker compose up` leaves telemetry off: the endpoint is empty, so the SDK never starts.

To trace a service you run from source (see [local development](local-development.md#work-on-one-service-without-docker-images)), start only the collector with `docker compose --profile observability up -d otel-lgtm` and set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in the service's `.env`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty (off) | OTLP/HTTP base URL. Traces go to `/v1/traces`, metrics to `/v1/metrics` |
| `OTEL_TRACES_SAMPLER_ARG` | `1` in development, `0.1` in production | Share of new traces kept. Sampling is parent-based, so a trace started upstream is kept or dropped as a whole |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` (compose: `15000`) | Metric export interval in ms |
| `SERVICE_VERSION` | `0.0.0-local` | `service.version` resource attribute; the Helm chart sets it to the image tag |
| `OTEL_RESOURCE_ATTRIBUTES` | | Extra resource attributes, e.g. `deployment.environment.name=staging` |

Telemetry config is validated at start-up like the rest of the config. A bad value stops the process with the variable's name, never its value.

## How it is wired

- `services/*/src/main.http.ts` and `main.worker.ts` start with `import '@aura/service-kit/telemetry/register';`. It has to be the first import, because instrumentation patches `http`, express, ioredis and Prisma as they load. `pnpm new-service` adds it.
- `ServiceKitModule` flushes and stops the SDK on shutdown, so the last spans are not lost on deploys.
- Tests run with telemetry off. `packages/service-kit/test/tracing.ts` registers an in-memory tracer for the tests that check propagation.
