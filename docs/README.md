# AuraCoach Documentation

Status: **Phases 1–3 drafted for review.** No application code exists yet; Phase 4 (foundation) starts after these documents are approved.

## Start here

1. [Discovery report](discovery/discovery-report.md) — repo inspection, product summary, MVP scope, assumptions, open questions, risks.
2. [Phased delivery plan](delivery/delivery-plan.md) — phases, slices, gates and acceptance.

## Index

| Area | Documents |
|---|---|
| Requirements | [PRD](requirements/product-requirements.md) · [User stories](requirements/user-stories.md) · [Acceptance criteria](requirements/acceptance-criteria.md) |
| UX | [Personas](ux/personas.md) · [User journeys & flows](ux/user-journeys.md) · [Information architecture](ux/information-architecture.md) · [Design system](ux/design-system.md) · [Wireframes](ux/wireframes.md) · [High-fidelity designs](ux/hifi-designs.md) · [Tokens](ux/tokens.json) · [Component inventory](ux/component-inventory.md) · [Content style guide](ux/content-style-guide.md) |
| Architecture | [HLD](architecture/HLD.md) · [Diagrams](architecture/architecture-diagrams.md) · [Security & privacy](architecture/security-architecture.md) · [Deployment](architecture/deployment-architecture.md) · [Service catalog](architecture/service-catalog.md) · [ADRs](architecture/ADR/) |
| Module LLDs | [Authentication](modules/authentication/LLD.md) · [Users & privacy](modules/users/LLD.md) · [Onboarding](modules/onboarding/LLD.md) · [Workouts](modules/workouts/LLD.md) · [Nutrition](modules/nutrition/LLD.md) · [AI coach & gateway](modules/ai-coach/LLD.md) · [Progress & dashboard](modules/progress/LLD.md) · [Notifications](modules/notifications/LLD.md) · [Admin](modules/admin/LLD.md) · [Platform / cross-cutting](modules/platform/LLD.md) |
| API | [OpenAPI 3.1](api/openapi.yaml) · [API guide](api/API-guide.md) |
| Database | Per-service Prisma schemas in `services/<name>/prisma/schema.prisma` (e.g. [profile](../services/profile-service/prisma/schema.prisma)) · [ERD](database/ERD.md) · [Data dictionary](database/data-dictionary.md) |
| Testing | [Test strategy](testing/test-strategy.md) · [Critical test cases](testing/test-cases.md) |
| Operations | [Local development](operations/local-development.md) · [Monitoring](operations/monitoring.md) · `deployment.md` and `troubleshooting.md` follow with the hosting work |

## Validation of these drafts

- Each of the 7 per-service Prisma schemas validates, and its baseline migration applies to Postgres 16 in CI (83 tables including replicas, outbox and dedupe tables).
- `redocly lint` on [openapi.yaml](api/openapi.yaml): valid, 67 operations; one warning (public health check has no 4xx response).

## Definition of Done

A feature is complete only when: UX and acceptance criteria are defined; HLD/LLD and API/database docs are updated; it works on the applicable platforms; authorisation and validation are implemented; unit and integration tests pass; relevant E2E tests pass; error, loading and failure states are handled; logging and monitoring are sufficient; no secrets or known critical security issues are introduced; and it is verified against its acceptance criteria.
