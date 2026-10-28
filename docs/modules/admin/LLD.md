# Administration and Content Management — Low-Level Design

Service: **apps/web `/admin` UI; endpoints live in the owning services; audit in audit-service** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

## 1. Surfaces

Next.js `/admin` (server components, MFA-enforced), backed by `/v1/admin/*` API routes guarded by permissions.

## 2. Content workflow

`DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED`, with `version` incremented on each publish. Editors create/edit drafts and submit them (`*:write`); reviewers send items back with a note (`*:review`) and publish or archive (`*:publish`). Published versions are immutable; edits are held as a revision (`pendingRevision`, with its own `revisionStatus` running through the same states) and replace the live values only when published. Read routes accept any of the type's permissions (`@AnyPermission` in service-kit), so editors and reviewers share one list. Users' historical logs keep snapshots, so content edits never change history.

| Content | Editor permission | Publisher | Validation on publish |
|---|---|---|---|
| Exercise | exercise:write | exercise:publish | media with alt text + captions, ≥ 1 primary muscle, equipment, contraindications reviewed |
| Food | food:write | food:publish | macros energy consistency ±15%, source and confidence set, household units in grams |
| Recipe | recipe:write | recipe:publish | allergens derived, yield set, composite food regenerated |
| Template | template:write | template:publish | `validatePlan` on generated sample plans for 20 synthetic profiles |
| Prompt | prompt:write | prompt:publish | eval suite thresholds met |
| Policy / model config | policy:write | owner | diff shown, reason required |

Bulk import: `pnpm nutrition:import <curated|fdc|ifct>` with a dry-run diff (nutrition LLD §4).

## 3. Review queues

Safety reviews (`SafetyReview`), user feedback (thumbs-down with reasons), food requests and user-submitted foods, flagged barcodes. Reviewer actions audited; reviewers see the minimum conversation excerpt needed.

## 4. Dashboards

Usage (DAU, sessions, logs), AI cost by feature/model/day vs budget, coach thumbs-up rate, safety-flag rate, error rate and latency (from Prometheus via Grafana embeds), queue health.

## 5. Audit

Every admin mutation writes an `AuditEvent` to the owning service's outbox in the same transaction (interceptor + explicit calls), with `before/after` minus sensitive fields; audit-service stores it append-only. Audit viewer filters by entity, actor, time. Export for compliance.

## 6. API (prefix /v1/admin, routed by the gateway to the owning service)

`/exercises`, `/templates` (workout) · `/foods`, `/recipes` (nutrition) · `/prompts`, `/model-configs`, `/policies`, `/reviews/safety`, `/feedback`, `/usage` (coach) · `/audit` (audit) · `/roles`, `/users/{id}` (profile). Content routes: CRUD + `/{id}/submit`, `/{id}/reject` (with a note), `/{id}/publish`, `/{id}/archive`. Foods also list `?qa=flagged` (nightly data QA findings). The support user view (`/users/{id}`, masked) is assembled by the web BFF from each service's admin read endpoint. Feature flags are managed in AWS AppConfig.
