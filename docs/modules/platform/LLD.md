# Platform (Cross-Cutting) — Low-Level Design

Covers what every module shares: request pipeline, jobs, caching, idempotency, events, rate limits, audit, dependency injection and test boundaries. API conventions (errors, pagination) are in the [API guide](../../api/API-guide.md).

## 1. Request pipeline (NestJS)

`RequestIdMiddleware` (accepts/creates `X-Request-Id`, binds OTel context) → `Helmet` → `ThrottlerGuard` (Redis) → `JwtAuthGuard` → `RolesGuard` → `ConsentGuard` → `ZodValidationPipe` → controller → `AuditInterceptor` (admin) → `ResponseMappingInterceptor` → `ProblemDetailsFilter` (RFC 9457 errors, no stack traces).

Logging: `pino` JSON with `requestId`, `traceId`, `route`, `status`, `durationMs`, `userHash` (HMAC of user id). Redaction paths: `req.body`, `*.email`, `*.notes*`, `authorization`, `cookie`.

## 2. Domain events and outbox

Modules publish events by inserting `OutboxEvent{id, type, payload, createdAt, processedAt}` in the same transaction. Worker polls every 1 s (`FOR UPDATE SKIP LOCKED`, batch 100), dispatches to in-process handlers and BullMQ queues, marks processed. Handlers are idempotent (keyed on event id).

| Event | Producers | Consumers |
|---|---|---|
| WorkoutCompleted | workouts | progress (PRs, summaries), notifications (suppress), cache invalidation |
| MealLogged / MealDeleted | nutrition | progress, dashboard cache |
| MeasurementAdded | progress | nutrition adaptation input, dashboard cache |
| ProfileChanged | users | workouts/nutrition proposals |
| ContentPublished | admin | cache invalidation, search reindex |
| RecommendationAccepted | coach/engines | workouts/nutrition apply, audit |
| AccountDeletionRequested | users | notifications cancel, devices purge |

## 3. Background jobs (BullMQ)

| Queue | Schedule | Idempotency | Retries | On final failure |
|---|---|---|---|---|
| outbox.dispatch | continuous | event id | handler-level 5× | dead-letter table + alert |
| plans.weekly-adapt | Sunday 04:00 local, fan-out per user | (userId, weekStart) unique on WorkoutPlanWeek | 3× backoff | keep current week, alert if > 1% fail |
| nutrition.adapt-targets | Sunday 05:00 local | (userId, effectiveFrom) | 3× | skip week |
| sessions.mark-missed | nightly 02:00 local | status guard | 3× | retried next night |
| notifications.plan / send / receipts | nightly / delayed / 15 min | dedupeKey | 3× | status FAILED |
| coach.weekly-summary | Sunday 08:30 local | (userId, week) | 2× | template summary without AI |
| privacy.export | on request | one active per user | 3× | DataRequest failed + support alert |
| privacy.purge | daily 03:00 UTC | status guard | 5× | alert (compliance) |
| content.recompute-composites | on recipe publish | recipe version | 3× | block publish |
| ai.usage-rollup | every 5 min | window key | 3× | — |

Worker concurrency per queue configured; per-user fan-out jobs use `jobId = queue:userId:period` to dedupe.

## 4. Caching strategy

| Key | TTL | Invalidation |
|---|---|---|
| `ex:list:{hash}`, `ex:{slug}` | 1 h | ContentPublished(exercise) — tag set `tag:exercise` |
| `food:search:{q}:{diet}:{allergens}` | 10 min | ContentPublished(food) bumps namespace version |
| `food:{id}` | 1 h | ContentPublished(food) |
| `dash:{userId}:{date}` | 5 min | MealLogged, WorkoutCompleted, MeasurementAdded, RecommendationChanged |
| `plan:{userId}:{weekStart}` | 5 min | session changes, adaptation |
| `perm:{userId}` | 10 min | role grant/revoke |
| `jwks` | 1 h | key rotation (kid miss → refetch) |

Never cached: coach messages, consent, anything after permission changes beyond TTL (role revoke also deletes key).

## 5. Idempotency

- Offline writes carry `clientId` (unique per user/table).
- Non-idempotent POSTs accept `Idempotency-Key` (stored in Redis 24 h with response hash); replay returns the stored response; mismatched body → `422 IDEMPOTENCY_KEY_REUSED`.

## 6. Rate limits and abuse

See [security architecture §5](../../architecture/security-architecture.md#5-rate-limiting-and-abuse). Additional abuse signals: rapid account creation per device, coach prompt-injection attempts (classifier category) counted per user → temporary coach cooldown after 5 in 24 h.

## 7. Dependency injection and test boundaries

- Domain engines are pure functions (no DI) → unit tested directly.
- Application services depend on ports (`WorkoutsRepositoryPort`, `LlmProvider`, `PushSender`, `Clock`, `IdGenerator`) bound in module providers; tests bind fakes (`FakeAdapter`, `InMemoryPushSender`, `FixedClock`).
- Infrastructure adapters (Prisma repositories, OFF client, Expo, SES, S3) covered by integration tests against Testcontainers / LocalStack / WireMock.
- Controllers covered by API tests via Supertest against the full Nest app with Testcontainers Postgres + Redis.
