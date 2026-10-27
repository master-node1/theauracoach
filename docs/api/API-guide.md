# API Guide

Contract: [openapi.yaml](openapi.yaml) (OpenAPI 3.1, lints clean with `redocly lint`; the only warning is the public health check having no 4xx response). In Phase 4 the spec is generated from Zod schemas in `packages/contracts` and this file becomes the CI-checked artefact; a typed client (`packages/api-client`) is generated for web and mobile.

## Routing

The public API is one contract served by several services. The nginx `api-gateway` validates nothing itself; it routes by path prefix (`/v1/me`, `/v1/onboarding`, `/v1/admin/roles` → profile; `/v1/exercises`, `/v1/workout-*` → workout; `/v1/foods`, `/v1/nutrition`, `/v1/meal-plans`, `/v1/recipes` → nutrition; `/v1/dashboard`, `/v1/progress` → progress; `/v1/coach`, `/v1/recommendations`, `/v1/admin/usage` → coach; `/v1/me/notification-preferences`, `/v1/me/devices`, `/v1/notifications` → notification; `/v1/admin/audit` → audit; `/v1/admin/{contentType}/…` → the service that owns that content type). More specific prefixes win, so `/v1/me/devices` reaches notification while the rest of `/v1/me` reaches profile. The full table is in the [service catalog](../architecture/service-catalog.md). `/internal/v1` is never routed by the gateway. Each service validates the Cognito token itself.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/v1`; breaking changes go to `/v2` with ≥ 6 months overlap; additive changes are non-breaking (clients ignore unknown fields) |
| Auth | `Authorization: Bearer <Cognito access token>`; web goes through the Next.js BFF with cookies |
| Content type | `application/json; charset=utf-8`; errors `application/problem+json`; coach streaming `text/event-stream` |
| Naming | camelCase JSON, kebab-case paths, plural nouns |
| Dates | `date` (YYYY-MM-DD) for user-local days, `date-time` (RFC 3339, UTC) for instants |
| Units | Metric in the API always (kg, cm, g, ml, kcal); clients convert |
| IDs | UUID; clients generate `clientId` for offline-created records |
| Pagination | Cursor-based: `?limit=20&cursor=…` → `{ items, nextCursor }`; `nextCursor: null` at the end; max limit 100 |
| Filtering | Explicit query params per endpoint; no generic query language |
| Idempotency | `clientId` on offline writes; `Idempotency-Key` header on non-idempotent POSTs (onboarding, meal-plan generation); keys kept 24 h |
| Concurrency | Proposals carry `basisVersion`; stale accept → `409 RECOMMENDATION_STALE`. Content admin uses `If-Match` with ETag |
| Caching | Library endpoints return `ETag` + `Cache-Control: public, max-age=300`; user data `private, no-store` |
| Rate limits | `429` with `Retry-After`; headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` |
| Tracing | Accepts `traceparent`; returns `X-Request-Id` (also in problem bodies) |

## Errors

RFC 9457 problem details with a stable `code`:

```json
{
  "type": "https://docs.auracoach.app/errors/validation-failed",
  "title": "Request validation failed",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "requestId": "6c1f…",
  "errors": [{ "path": "sets[0].reps", "message": "Must be between 0 and 100" }]
}
```

| HTTP | Codes |
|---|---|
| 400 | `BAD_REQUEST` (malformed JSON) |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `MFA_REQUIRED`, `CONSENT_REQUIRED`, `REAUTH_REQUIRED` (sign in again, then retry; account deletion) |
| 404 | `NOT_FOUND` (also for resources owned by someone else) |
| 409 | `SESSION_CLOSED`, `RECOMMENDATION_STALE`, `EXPORT_IN_PROGRESS`, `VERSION_CONFLICT`, `RESTORE_WINDOW_CLOSED` |
| 422 | `VALIDATION_FAILED`, `UNIT_NOT_SUPPORTED`, `IDEMPOTENCY_KEY_REUSED`, `PLAN_RULE_VIOLATION` |
| 423 | `ACCOUNT_PENDING_DELETION` (every service except `GET /v1/me`, exports and restore; show the restore screen) |
| 429 | `RATE_LIMITED`, `COACH_QUOTA_REACHED` |
| 503 | `COACH_UNAVAILABLE`, `DEPENDENCY_UNAVAILABLE` |

## Example: log food

```http
POST /v1/nutrition/entries
Authorization: Bearer eyJ…
Content-Type: application/json

{ "clientId": "1b9d…", "date": "2026-10-11", "slot": "LUNCH",
  "foodId": "a0c3…", "quantity": 1, "unitCode": "katori", "state": "COOKED", "method": "search" }
```

```json
201 Created
{ "id": "f7e2…", "date": "2026-10-11", "slot": "LUNCH", "foodId": "a0c3…",
  "name": "Toor dal, cooked", "quantity": 1, "unitCode": "katori", "grams": 150, "state": "COOKED",
  "nutrients": { "energy_kcal": 171, "protein_g": 9.2, "carb_g": 25.1, "fat_g": 3.9, "fibre_g": 4.4 },
  "confidence": "HIGH" }
```

## Example: coach SSE

```text
event: delta
data: {"text":"Sure. An easy 30-minute run keeps your week balanced"}

event: proposal
data: {"id":"9a…","kind":"WORKOUT_SWAP","title":"Sun: Legs → Easy run","status":"PENDING", …}

event: done
data: {"messageId":"c4…","followUps":["Why is my protein 110 g?"]}
```

Clients reconnect with `Last-Event-ID`; the server replays the completed message from storage.

## Integration contracts

| External | Contract | Timeout / retry | Failure mode |
|---|---|---|---|
| Cognito | OIDC discovery + JWKS | JWKS cached 1 h | Cached keys continue; new logins fail with friendly error |
| AI provider | Through `ai-gateway` port only | Per-feature timeout, 2 retries | Coach fallback; core unaffected |
| Open Food Facts | `GET /api/v2/product/{barcode}` with app User-Agent | 2 s, 1 retry | "Not found — add manually" |
| Expo Push | `POST /--/api/v2/push/send`, receipts | 3 retries | In-app inbox still updated |
| SES | SendEmail via SDK | 3 retries | Logged, retried by job |
