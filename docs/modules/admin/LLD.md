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

## 5. Audit

Every admin mutation writes an `AuditEvent` to the owning service's outbox in the same transaction (interceptor + explicit calls), with `before/after` minus sensitive fields; audit-service stores it append-only. Audit viewer filters by entity, actor, time. Export for compliance.

## 6. API (prefix /v1/admin, routed by the gateway to the owning service)

`/exercises`, `/templates` (workout) · `/foods`, `/recipes` (nutrition) · `/prompts`, `/model-configs`, `/policies`, `/reviews/safety`, `/feedback`, `/usage` (coach) · `/audit` (audit) · `/roles`, `/users/{id}` (profile). Content routes: `GET` (list versions: `status`, `q`, cursor), `GET /{id}`, `POST` (draft), `PUT /{id}` (edit; 201 when it opens a new version), `/{id}/submit`, `/{id}/publish`, `/{id}/archive`; `{id}` is a version id. The support user view (`/users/{id}`, masked) is assembled by the web BFF from each service's admin read endpoint. Feature flags are managed in AWS AppConfig.
