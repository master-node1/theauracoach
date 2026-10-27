# Platform (Cross-Cutting) — Low-Level Design

Service: **`packages/service-kit`, used by every service** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

Covers what every service shares: request pipeline, service-to-service calls, events, jobs, caching, idempotency, rate limits, audit, dependency injection and test boundaries. API conventions (errors, pagination) are in the [API guide](../../api/API-guide.md).

## 1. Service skeleton

```text
services/<name>-service/
  src/
    main.http.ts            # public /v1 + /internal/v1 controllers
    main.worker.ts          # outbox relay, event consumers, BullMQ processors
    app.module.ts
    <feature>/ controllers/ application/ infrastructure/ events/
  prisma/ schema.prisma migrations/ seed.ts
  test/ unit/ integration/ contract/
  Dockerfile  README.md  docs/{HLD,LLD,API,DATABASE,FLOWS,TESTING}.md
```

`service-kit` provides `ServiceKitModule.forRoot({ name, db, redis, events })`, which wires config (Zod-validated env), pino logging, OpenTelemetry, health endpoints, guards, problem-details filter, outbox, event bus, idempotency store and the internal HTTP client.

## 2. Request pipeline

`RequestIdMiddleware` (accepts/creates `X-Request-Id`, binds OTel context) → `Helmet` → `ThrottlerGuard` (Redis) → `JwtAuthGuard` or `InternalServiceGuard` → `PermissionsGuard` → `ConsentGuard` → `ZodValidationPipe` → controller → `AuditInterceptor` (admin routes) → `ResponseMappingInterceptor` → `ProblemDetailsFilter` (RFC 9457 errors, no stack traces).

Logging: `pino` JSON with `service`, `requestId`, `traceId`, `route`, `status`, `durationMs`, `userHash` (HMAC of user id). Redaction paths: `req.body`, `*.email`, `*.notes*`, `authorization`, `cookie`.

## 3. Internal HTTP client

`InternalClient.call(target, method, path, { asUser?, body, idempotencyKey })`:
- mints a service JWT (`iss` = self, `aud` = target, `sub_user` when acting for a user, 5 min);
- timeout 2 s (dashboard read 300 ms), 1 retry with jitter for GET and for writes with an idempotency key;
- circuit breaker per target (`opossum`: open after 50% failures over 20 requests, half-open after 10 s);
- typed with the target's internal contract from `packages/contracts/internal/<service>`.

## 4. Events

### 4.1 Envelope

```json
{
  "id": "evt_01J…",
  "type": "WorkoutCompleted",
  "version": 1,
  "occurredAt": "2026-10-11T06:42:10Z",
  "producer": "workout-service",
  "userId": "8f1c…",
  "traceparent": "00-…",
  "data": { "sessionId": "…", "date": "2026-10-11", "status": "COMPLETED", "volumeKg": 5240, "durationMin": 38 }
}
```

### 4.2 Outbox → Redis Streams

1. Application service writes its rows and an `OutboxEvent` row in one transaction.
2. Relay (worker) polls every 250 ms (`FOR UPDATE SKIP LOCKED`, batch 100), `XADD aura.<Type>.v<version>`, marks `publishedAt`; on Redis failure retries with backoff and alerts if backlog > 1,000 or oldest > 60 s.
3. Consumers read with `XREADGROUP` (group = consuming service), handle, record `ProcessedEvent(eventId)` in the same transaction as their own writes, then `XACK`. Pending entries older than 60 s are reclaimed with `XAUTOCLAIM`; after 5 failed attempts the entry moves to `aura.dlq.<service>` and pages on-call.
4. Streams trimmed to ~7 days; outbox rows deleted after 7 days.

### 4.3 Event catalogue (v1)

| Event | Producer | Consumers | Key data |
|---|---|---|---|
| UserRegistered | profile | notification, audit | userId, timezone, locale |
| ProfileChanged | profile | workout, nutrition, coach, notification (time zone), audit (field names) | `fields` + `changes` (new values). v1: timezone, locale, heightCm, activityLevel, experience, dietType, cuisines, allergens, trainingDays, sessionMinutes, location, equipment. Onboarding-owned fields (sex, birthYear, intensityCap, conditionCodes, goal) are added as optional fields with slice 5.2 |
| ConsentChanged | profile | coach, notification, audit | purpose, granted, policyVersion |
| OnboardingCompleted | profile | workout, nutrition | onboardingId, snapshot needed for plan and targets |
| ExportRequested / ExportPartReady | profile / each service | each service / profile | requestId |
| AccountDeletionRequested / AccountDeleted / UserDataPurged | profile / profile / each service | notification / all / profile | userId |
| PlanCreated, PlanWeekReady | workout | progress, notification, coach | planId, weekStart, rationale codes |
| PlanAdjustmentProposed | workout | coach | change set, basisVersion, explanation codes |
| WorkoutCompleted, SessionMissed, PersonalRecordSet | workout | progress, notification | sessionId, date, status, volume, PRs |
| TargetsSet, TargetChangeProposed | nutrition | progress, coach | targets / proposal |
| MealLogged, MealDeleted, WaterLogged | nutrition | progress, notification | date, slot, kcal and macro totals for the entry (no food names) |
| MeasurementAdded, CheckInSaved, PlateauDetected | progress | nutrition, workout, coach | type, value, date / scores / kind |
| RecommendationCreated, RecommendationAccepted | coach | notification, audit | id, kind, owner service |
| SafetyFlagRaised | coach | audit | conversationId, category |
| ContentPublished | workout, nutrition, coach | same service (cache), audit | contentType, id, version |
| AuditEvent | every service | audit | actor, action, entity, before/after (redacted) |

Compatibility: adding optional fields is a minor change within a version; anything else is a new version, consumers ship support first, producers dual-publish until all consumers move.

## 5. Background jobs (BullMQ, per service)

| Service | Queue | Schedule | Idempotency | On final failure |
|---|---|---|---|---|
| workout | plans.weekly-adapt | Sunday 04:00 user-local, fan-out per user | (userId, weekStart) unique on WorkoutPlanWeek | keep current week, alert if > 1% fail |
| workout | sessions.mark-missed | nightly 02:00 local | status guard | retried next night |
| nutrition | nutrition.adapt-targets | Sunday 05:00 local | (userId, effectiveFrom) | skip week |
| nutrition | composites.recompute | on recipe publish | recipe version | block publish |
| nutrition | foods.data-qa | nightly | — | report only |
| progress | progress.plateau-scan | Sunday 06:00 local | (userId, week) | skip |
| coach | coach.weekly-summary | Sunday 08:30 local | (userId, week) | template summary without AI |
| coach | ai.usage-rollup | every 5 min | window key | — |
| notification | notifications.plan / send / receipts | nightly / delayed / 15 min | dedupeKey | status FAILED |
| profile | privacy export zip | on the last ExportPartReady | requestId (row lock) | event retried; export failed after 60 min |
| profile | privacy.jobs (due deletions, finish deletions, ack alerts, export expiry) | every 15 min (`PRIVACY_JOB_INTERVAL_SECONDS`) | status guards + row locks | `aura.privacy.purge_ack_missing` alert (compliance) |
| audit | audit.retention | monthly | partition | alert |

Per-user fan-out jobs use `jobId = queue:userId:period` to dedupe across worker replicas.

## 6. Caching (inside the owning service)

| Service | Key | TTL | Invalidation |
|---|---|---|---|
| workout | `wo:ex:list:{hash}`, `wo:ex:{slug}` | 1 h | ContentPublished(exercise) bumps namespace version |
| workout | `wo:plan:{userId}:{weekStart}` | 5 min | session changes, adaptation |
| nutrition | `nu:search:{q}:{diet}:{allergens}`, `nu:food:{id}` | 10 min / 1 h | ContentPublished(food) |
| progress | `pr:dash:{userId}:{date}` | 5 min | every consumed event for that user and date |
| all | `jwks` | 1 h | kid miss → refetch |

Never cached: coach messages, consent decisions beyond the replica, anything permission-related beyond the token lifetime.

## 7. Idempotency

- Offline writes carry `clientId` (unique per user and table).
- Non-idempotent public POSTs accept `Idempotency-Key` (Redis 24 h with response hash); replay returns the stored response; a different body → `422 IDEMPOTENCY_KEY_REUSED`.
- Internal writes always carry an idempotency key (onboarding id, proposal id).
- Event handlers dedupe with `ProcessedEvent`.

## 8. Audit

`AuditInterceptor` and explicit calls write an `AuditEvent` to the service's outbox in the same transaction as the change; audit-service stores it append-only. Admin audit search queries audit-service only.

## 9. Rate limits and abuse

Limits are in [security architecture §5](../../architecture/security-architecture.md#5-rate-limiting-and-abuse). Two layers:

1. **Gateway (first line).** nginx `limit_req` per client IP (`GATEWAY_RATE_PER_SECOND`, 20 r/s with a burst of 40, 20 on `/v1/coach`), answering `429 RATE_LIMITED` with `Retry-After: 1`. `/health` is not limited.
2. **Services.** `RateLimitGuard` in service-kit, a global guard that runs after `AuthGuard`. Every public route is charged to `rl:api:ip:{ip}` (`RATE_LIMIT_IP_PER_MINUTE`, 1000) and, when signed in, `rl:api:user:{userId}` (`RATE_LIMIT_USER_PER_MINUTE`, 300). Routes add their own buckets with `@RateLimit(...)`; the presets are `RATE_LIMITS.search` (60/min), `coachPerMinute` (10/min), `coachPerDay` (30/day) and `uploadsPerDay` (20/day). Every service uses the same Redis, so a bucket name is one counter across all services.

The limiter is a sliding-window log: one sorted set per bucket, scored by Redis server time. A Lua script checks every bucket of the request first and charges them only if all have room, so a refused request counts against nothing and one limit cannot use up another. Over a limit the service answers `429 RATE_LIMITED` (problem details) with `Retry-After` set to the seconds until the oldest counted request leaves the window. Health checks (`@SkipRateLimit()`) and `/internal/v1` routes are never limited. If Redis is unreachable the guard lets the request through and logs a warning; the gateway limit still applies. `RATE_LIMIT_ENABLED=false` turns the service layer off (load tests only).

Coach prompt-injection attempts (classifier category) are counted per user → temporary coach cooldown after 5 in 24 h.

## 10. Dependency injection and test boundaries

- Domain engines are pure functions (no DI) → unit tested directly.
- Application services depend on ports (`Repository`, `EventPublisher`, `InternalClient`, `LlmProvider`, `PushSender`, `Clock`, `IdGenerator`); tests bind fakes (`InMemoryEventPublisher`, `FakeInternalClient`, `FakeLlmAdapter`, `FixedClock`).
- Infrastructure adapters (Prisma repositories, Redis Streams bus, OFF client, Expo, SES, S3) covered by integration tests against Testcontainers / LocalStack / WireMock.
- Controllers covered by API tests via Supertest against the full Nest app with Testcontainers Postgres + Redis.
- Cross-service contracts: consumer-driven contract tests for internal APIs (Pact) and schema tests for every event a service publishes or consumes.

## 11. Feature flags

Every Phase 5 slice ships behind a flag. The catalogue is typed in `packages/contracts/src/flags.ts` (`settings_v1`, `privacy_v1`, `onboarding_v1`, `workouts_v1`, `nutrition_v1`, `coach_v1`, `coach_enabled`, `progress_v1`, `notifications_v1`, `meal_plans_v1`, `barcode_v1`), each with a default.

**Flag document.** One JSON document holds a rule per flag: `{"flags": {"coach_v1": {"enabled": true, "rolloutPercent": 10, "users": {"<userId>": true}}}}`. Flags without a rule use their default. `users` overrides win; otherwise `enabled: false` is off, and `enabled: true` with `rolloutPercent` is on for users whose bucket (FNV-1a of `flagKey:userId`, mod 10 000) is below the percentage, so the same users stay in as the percentage grows. Without a user id a partial rollout is off. Unknown flag keys fail validation and the last good document stays in use.

**Sources** (`FLAGS_SOURCE`):

| Source | Where | Writes |
|---|---|---|
| `env` (default) | No document; catalogue defaults with `FEATURE_<KEY>` variables | — |
| `file` | `FLAGS_FILE`, re-read every `FLAGS_POLL_SECONDS`. Local compose uses `infra/local/flags/flags.json` every 5 s | `PUT`/`DELETE /v1/admin/flags/{key}` (profile-service) |
| `appconfig` | AWS AppConfig Data: freeform JSON profile `APPCONFIG_APPLICATION`/`APPCONFIG_ENVIRONMENT`/`APPCONFIG_PROFILE`, polled every 45 s through a configuration session with the pod's IAM role | AppConfig deployments only (Terraform, TAC-36, or the console); the admin API answers `409 FLAGS_READ_ONLY` |

In every source `FEATURE_<KEY>` env values are the defaults under the document, so the old env flags keep working. Reads that fail keep the last good document.

**In services** inject the `FeatureFlags` port (`isEnabled(key, userId)`, `evaluate(userId)`), or mark a route `@RequireFlag('coach_v1')` so it answers 404 while the flag is off for the caller. Tests bind `StaticFeatureFlags`. Evaluation is in memory.

**In the apps** `GET /v1/me/flags` (profile-service) returns every flag evaluated for the caller. The web app reads it once per request (`currentFlags()`), the mobile app after sign-in (`useFlags()`), both through `loadFlags` in `packages/api-client`, falling back to `FEATURE_<KEY>` (web) or `EXPO_PUBLIC_FEATURE_<KEY>` (mobile) defaults when the call fails.

**Kill switch.** `coach_enabled=false` turns the coach off everywhere within one poll interval (AI coach LLD: budget exhausted).

