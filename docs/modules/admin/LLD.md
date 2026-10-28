# Administration and Content Management — Low-Level Design

Service: **apps/web `/admin` UI; endpoints live in the owning services; audit in audit-service** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

## 1. Surfaces

Next.js `/admin` (server components, MFA-enforced), backed by `/v1/admin/*` API routes guarded by permissions.

## 2. Content workflow

`DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED`. Editors (`*:write`) create, edit and submit drafts; reviewers (`*:publish`) publish and archive; anyone with write, review or publish on the type can read the versions. Published versions are immutable: editing one opens version + 1 as a draft (one open draft per item; a second answers `409 DRAFT_EXISTS`), editing an in-review version sends it back to draft, and publishing supersedes the previous live version without changing it. Archiving a draft withdraws it; archiving the live version takes the item out of the library (an exercise a live template uses answers `409 EXERCISE_IN_USE`). Every step writes an `AuditEvent`; a publish also writes `ContentPublished` in the same transaction. Users' historical logs keep snapshots, so content edits never change history.

Refused publishes answer `422 PUBLISH_CHECKS_FAILED` with one `errors[]` entry per failed check (path and code). Workout codes: `MISSING_PRIMARY_MUSCLE`, `MUSCLE_PRIMARY_AND_SECONDARY`, `MISSING_EQUIPMENT`, `BODYWEIGHT_WITH_EQUIPMENT`, `MISSING_INSTRUCTIONS`, `CONTRAINDICATIONS_NOT_REVIEWED`, `MEDIA_ALT_TEXT_MISSING`, `MEDIA_CAPTIONS_MISSING` (videos), `LINK_TO_SELF`, `UNKNOWN_LINKED_EXERCISE`, `EXERCISE_NOT_PUBLISHED` and `SAMPLE_PLAN_INVALID` (template: the profile, the engine error and the failed `validatePlan` rules). The 20 synthetic profiles are `templateCheckProfiles` in `@aura/domain/workouts`.

| Content | Editor permission | Publisher | Validation on publish |
|---|---|---|---|
| Exercise | exercise:write | exercise:publish | media with alt text (+ captions on video), ≥ 1 primary muscle, equipment, instructions, contraindications reviewed, regression/progression links exist |
| Food | food:write | food:publish | macros energy consistency ±15%, source and confidence set, household units in grams |
| Recipe | recipe:write | recipe:publish | allergens derived, yield set, composite food regenerated |
| Template | template:write | template:publish | every exercise live; `validatePlan` on generated sample plans for 20 synthetic profiles (short/long sessions, back-to-back days, each condition, low cap, sparse equipment) |
| Prompt | prompt:write | prompt:publish | eval suite thresholds met |
| Policy / model config | policy:write | owner | diff shown, reason required |

Bulk import: CSV/JSON importers for IFCT and FDC with dry-run diff.

## 3. Review queues

Safety reviews (`SafetyReview`), user feedback (thumbs-down with reasons), food requests and user-submitted foods, flagged barcodes. Reviewer actions audited; reviewers see the minimum conversation excerpt needed.

## 4. Dashboards

Usage (DAU, sessions, logs), AI cost by feature/model/day vs budget, coach thumbs-up rate, safety-flag rate, error rate and latency (from Prometheus via Grafana embeds), queue health.

Built in TAC-32:

- **Dashboard** (`/admin`): DAU, sign-ups (7 days), sessions and meals logged (24 h), and the latest audit entries, each shown only to roles with `usage:read` / `audit:read`.
- **Usage and health** (`/admin/usage`, `usage:read`): every service's counters from `GET /v1/admin/ops/{service}/usage`, Grafana panels from `ADMIN_GRAFANA_PANELS` (`Title|url,…`; hidden when unset) and queue health (outbox backlog, oldest unpublished row, dead letters) from `GET /v1/admin/ops/{service}/queues`.
- DAU comes from `User.lastActiveAt`, which `GET /v1/me` sets at most once an hour. Sessions and meals come from workout-service and nutrition-service. AI cost and coach quality arrive with TAC-34.
- **Operations** (`/admin/operations`, `event:replay`, owner only): each service's dead-letter stream (newest 100, payloads stay on the server). Replay takes a reason and moves the entry back to its stream with one Lua script (XRANGE, XDEL, XADD), so two replays of the same entry publish it once. The `event.replay` audit event is written in the same transaction; consumers that already handled the event skip it through `ProcessedEvent`.

## 5. Audit

Every admin mutation writes an `AuditEvent` to the owning service's outbox in the same transaction (interceptor + explicit calls), with `before/after` minus sensitive fields; audit-service stores it append-only. Audit viewer filters by entity, actor, time. Export for compliance.

Built in TAC-32:

- Sensitive actions (role grant and revoke, dead-letter replay) carry a `reason` the console always asks for; it is stored in `AuditLog.reason`.
- Append-only is enforced in the database: a trigger refuses UPDATE, DELETE and TRUNCATE on `AuditLog`, and the API has no route that changes an entry. The one exception is account deletion (TAC-7), which may only clear `before`, `after` and `ipHash` and must leave every other column as it was.
- `GET /v1/admin/audit` filters by item type and id, actor, action (whole or prefix such as `role`) and time, newest or oldest first, with id-based cursor pages. `GET /v1/admin/audit/{id}` feeds the before/after diff. `GET /v1/admin/audit/export.csv` returns up to 10,000 rows, neutralises spreadsheet formulas and records an `audit.export` entry. Keys such as `email`, `notes` and `token` show as `[removed]` everywhere (`redactAuditValue` in contracts).
- Viewing a user's support view writes `user.support_view`.

## 6. API (prefix /v1/admin, routed by the gateway to the owning service)

`/exercises`, `/templates` (workout) · `/foods`, `/recipes` (nutrition) · `/prompts`, `/model-configs`, `/policies`, `/reviews/safety`, `/feedback`, `/usage` (coach) · `/audit` (audit) · `/roles`, `/users/{id}` (profile). Content routes: `GET` (list versions: `status`, `q`, cursor), `GET /{id}`, `POST` (draft), `PUT /{id}` (edit; 201 when it opens a new version), `/{id}/submit`, `/{id}/publish`, `/{id}/archive`; `{id}` is a version id. The support user view (`/users/{id}`, masked) is assembled by the web BFF from each service's admin read endpoint. Feature flags are managed in AWS AppConfig.

Per-service operations live under `/v1/admin/ops/{service}/…` (`AdminOpsController` in service-kit, routed by the gateway to the named service): `users/{id}` (support-view section, `user:support_read`), `usage` and `queues` (`usage:read`), `dlq` and `dlq/{id}/replay` (`event:replay`). A service adds its section and counters by providing `ADMIN_REPORTS`.

Support view (TAC-32, `/admin/users`, `user:support_read`): look up by email (`GET /v1/admin/users?email=`, answers with a masked email such as `pr***@e***.com`) or by user id. The page shows profile-service's account section (status, dates, locale, onboarding state, roles, current consents; the view is audited) and counts and dates from workout, nutrition, progress, coach and notification. No profile details, health data or conversation text appear; a service that does not answer shows as unavailable without hiding the rest.

Console access (TAC-32): every `/admin/*` page needs the permission of the API it calls (`proxy.ts` answers 403 otherwise), so a section is hidden and its API refuses the same people. Sections without pages yet (content, review queues, prompts) show as "Soon" until TAC-33 and TAC-34.
