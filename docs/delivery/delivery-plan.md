# Phased Delivery Plan

Each phase ends with a review gate: the product owner approves the listed deliverables before the next phase starts. Sizing assumes a team of ~4 engineers + 1 designer + part-time trainer/nutrition reviewer, in 2-week sprints; it is an indicative estimate to be re-planned after Phase 2.

```mermaid
flowchart LR
  P1[1 Discovery] --> P2[2 UX/UI] --> P3[3 HLD/LLD] --> P4[4 Foundation] --> P5[5 MVP slices] --> P6[6 Quality & release]
  P5 --> P7[7 Post-MVP]
```

## Phase 1 — Discovery (this PR)

| | |
|---|---|
| Deliverables | [Discovery report](../discovery/discovery-report.md), [PRD](../requirements/product-requirements.md), [user stories](../requirements/user-stories.md), [acceptance criteria](../requirements/acceptance-criteria.md), personas |
| Dependencies | Product owner answers to the 3 open questions |
| Risks | Assumed market/monetisation wrong → scope change |
| Decisions | MVP scope, deferred features, success metrics |
| Acceptance | Owner signs off scope, metrics and open questions |

## Phase 2 — UX/UI (1–2 sprints)

| | |
|---|---|
| Deliverables | Validated journeys and IA (this PR, draft), low-fi wireframes (this PR), interactive high-fidelity prototype for the 14 primary screens in light and dark, design tokens JSON, component inventory, accessibility annotations, content style guide, 5–6 user tests with target personas |
| Dependencies | Phase 1 sign-off; brand name/logo decision |
| Risks | Logging flow too slow → test "log 2 rotis + dal" under 10 s |
| Decisions | Navigation model, chart types, tone of voice, onboarding length |
| Acceptance | ≥ 4 of 5 testers complete onboarding and log a meal unaided; a11y review passes; owner approves hi-fi |

## Phase 3 — HLD and LLD (in parallel with Phase 2, 1 sprint)

| | |
|---|---|
| Deliverables | HLD, 8 ADRs, security and deployment architecture, module LLDs, Prisma schema, ERD, data dictionary, OpenAPI contract, test strategy (all drafted in this PR) |
| Dependencies | Phase 1 decisions (market drives residency; monetisation drives billing module) |
| Risks | Cognito UX limits; AI cost per user |
| Decisions | ADR-001…008 accepted or amended |
| Acceptance | Owner + one external reviewer approve ADRs; OpenAPI and schema validated in CI |

## Phase 4 — Foundation (2 sprints)

| | |
|---|---|
| Deliverables | pnpm + Turborepo monorepo (`apps/api`, `apps/worker`, `apps/web`, `apps/mobile`, `packages/*`); strict TS, ESLint (+ boundaries), Prettier, Husky + commitlint; Docker Compose local stack; Prisma baseline migration + seeds; NestJS skeleton with config, pino logging, OTel, Problem Details, health; Cognito + BFF auth end-to-end; Expo app shell with auth and tabs; Next.js shell with auth and admin layout; GitHub Actions (lint, typecheck, unit, integration with Testcontainers, CodeQL, gitleaks, Trivy); Terraform for dev; EAS dev builds; `AGENTS.md`/`CLAUDE.md`; operations docs (local development, deployment, monitoring, troubleshooting) |
| Dependencies | AWS accounts, Apple/Google developer accounts, domain |
| Risks | Expo + monorepo tooling friction (Metro config) |
| Acceptance | A user can sign up and see an empty "Today" on web, iOS simulator and Android emulator in dev; CI green; `docker compose up` + `pnpm dev` works from a clean clone |

## Phase 5 — MVP vertical slices (≈ 8–10 sprints)

Each slice ships API + web + mobile + tests + docs, behind a feature flag, and is demoed.

| # | Slice | Key acceptance (see test cases) | Depends on |
|---|---|---|---|
| 5.1 | Authentication and profile | TC-SEC-3/4, TC-PRV-1..4, settings screens, export/delete | Phase 4 |
| 5.2 | Goals and onboarding | TC-ONB-1..6, plan-reveal screen, starting assessment | 5.1, content: 120 exercises, 12 templates |
| 5.3 | Workout plans and session tracking | TC-WO-1..11, offline logging, rest timer, substitutions, weekly adaptation job | 5.2 |
| 5.4 | Nutrition targets, food logging, meal plans | TC-NU-1..13, 800 Indian dishes + IFCT/FDC import, barcode, grocery list | 5.2, nutrition reviewer |
| 5.5 | AI coach with validated recommendations | TC-CO-1..12, eval suite thresholds, safety review queue, cost dashboard | 5.3, 5.4 |
| 5.6 | Progress tracking and dashboard | Trends, PRs, plateau proposals, Today dashboard budgets | 5.3, 5.4 |
| 5.7 | Notifications (+ integrations P2) | TC-NO-1..6, preferences, weekly summary | 5.6 |
| 5.x | Admin console (incrementally per slice) | Content workflow, audit, roles | each slice |

Risks: content creation is on the critical path (exercises, media, Indian dishes) → start content production during Phase 4 with the admin import tooling first.

## Phase 6 — Quality and release (2 sprints)

| | |
|---|---|
| Deliverables | Full regression, k6 load at 3× expected beta traffic, ZAP DAST, external pentest, accessibility audit (WCAG 2.2 AA web, VoiceOver/TalkBack), AI red-team run, privacy notice + DPDP consent review by counsel, App Store/Play listings and privacy labels, staging→prod runbooks, rollback rehearsal, on-call rota, support macros |
| Acceptance | All TC-E2E pass on web/iOS/Android; no critical/high findings open; SLO dashboards and alerts live; closed beta of 200 users with crash-free sessions ≥ 99.5% |

## Phase 7 — Post-MVP (prioritised backlog)

1. Apple Health / Health Connect.
2. Progress photos (consented, private).
3. Meal-photo recognition (suggestions only).
4. Subscriptions (App Store, Play Billing, Razorpay) if monetisation enabled.
5. Hindi and regional languages.
6. Wearables beyond the platform health stores.

## Cross-phase governance

- Definition of Done per [brief §14](../README.md#definition-of-done).
- Weekly demo; ADR for any decision that changes architecture; docs updated in the same PR as code.
- Metrics review after each slice against discovery success metrics.
