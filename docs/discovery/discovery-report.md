# Discovery Report

Status: **Draft for review** · Phase 1 (Discovery) · 2026-10-11

## 1. Repository inspection

| Repository | What it contains | What it means for AuraCoach |
|---|---|---|
| `master-node1/theauracoach` (this repo) | `README.md`, MIT `LICENSE`, Node `.gitignore`. One commit, no code. | Greenfield. No existing functionality to preserve. Folder layout, tooling and conventions are ours to choose. |
| `master-node1/the-aura-lab` (sibling, read-only) | NestJS 10 + Prisma 6 microservices, PostgreSQL 16, Redis 7, a Python FastAPI AI service using OpenAI via LangChain, nginx gateway, GitHub Actions CI with CodeQL and njsscan, Terraform + Helm to EKS, `AGENTS.md`/`CLAUDE.md` engineering rules. | The owner already runs NestJS, Prisma, Postgres, Redis, GitHub Actions, Terraform and EKS. We reuse those skills, the ADR template and the doc conventions. We deliberately do **not** copy its microservice split (see [ADR-001](../architecture/ADR/ADR-001-modular-monolith.md)). |
| `master-node1/eks-terraform-template` (private, not opened) | Name suggests an EKS Terraform baseline. | Candidate base for Phase 4 infrastructure. To confirm in Phase 4. |

Local toolchain in the build container: Node 22, npm 10, pnpm 10.

## 2. Product summary

AuraCoach is an AI personal trainer and nutrition coach for web, Android and iOS. A user completes a safety-screened onboarding, receives a deterministic, rule-validated workout plan and nutrition targets, logs workouts and food (including Indian and regional foods with raw/cooked measures), and talks to an AI coach that explains, summarises and proposes adjustments through validated application services. An admin console manages content, AI policy and cost.

## 3. Target users (assumed)

| Segment | Why they come | What they need most |
|---|---|---|
| Urban Indian professionals, 22–40, beginner to intermediate | Lose fat or get fit around a busy schedule | Short home or gym plans, Indian vegetarian and non-vegetarian food logging, gentle reminders |
| Gym regulars wanting structure | Muscle gain and strength | Progressive overload, PR tracking, protein targets |
| Returners after a break or minor injury | General fitness | Conservative plans, substitutions, safety screening |

Full personas: [ux/personas.md](../ux/personas.md).

## 4. Problem and value

Generic apps either give static plans or calorie counters that do not know Indian food. Human coaches are expensive. AuraCoach's value is **one plan that adapts weekly**, **food logging that understands dal, roti and idli by weight or katori**, and **a coach that explains why** — without pretending to be a doctor.

## 5. MVP scope (proposed default)

In MVP:
1. Email/password and Google/Apple sign-in, password recovery, account deletion and data export.
2. Onboarding with PAR-Q+ style safety screening, goals, equipment, schedule, diet and allergies.
3. Rule-based workout plan generation (gym, home, dumbbell-only, bodyweight), active session logging, RPE and soreness feedback, weekly adaptation, substitutions.
4. Calorie and macro targets (Mifflin-St Jeor + activity factor), food search over a curated Indian + global dataset, manual entry, barcode lookup, water, recipe-based meal plans with grocery list.
5. AI coach chat with tool calling over validated services, safety policy, usage limits and graceful fallback.
6. Dashboard, weight and measurement trends, workout volume and PRs, weekly summary.
7. Push and email reminders with user-controlled frequency.
8. Admin console for exercises, foods, recipes, templates, AI prompts/policies, usage and audit.

Deferred to post-MVP (Phase 7+): meal-photo recognition, progress photos, wearables (Apple Health, Health Connect), subscriptions/payments, regional languages, coach-to-human escalation marketplace.

## 6. Business model (assumed)

Free during beta. Freemium later: free tier with limited daily AI coach messages, paid tier for unlimited coach, meal plans and wearables. The data model includes `Subscription` and `UsageRecord` from day one so enabling paid plans does not need a schema rewrite, but no payment provider is integrated in MVP.

## 7. Constraints

- Health-adjacent personal data. India's DPDP Act 2023 applies for Indian users; GDPR applies if EU users are served. Data residency default: AWS `ap-south-1` (Mumbai).
- Not a medical device. No diagnosis, no treatment, no clinical nutrition (e.g. diabetes or kidney diets) — those route to professionals.
- Nutrient values must come from datasets (IFCT 2017, USDA FoodData Central, Open Food Facts), never from the language model.
- One small team; operational simplicity beats architectural purity.

## 8. Success metrics

| Metric | MVP target (first 90 days of beta) |
|---|---|
| Onboarding completion | ≥ 70% of sign-ups reach a generated plan |
| Week-4 retention | ≥ 30% of activated users log a workout or meal in week 4 |
| Weekly consistency | Median user completes ≥ 60% of planned sessions |
| Food logging | ≥ 4 logging days per week among active users |
| Coach usefulness | ≥ 80% thumbs-up on coach answers; < 1% flagged unsafe in review |
| Reliability | 99.5% monthly API availability; p95 API latency < 400 ms (non-AI) |
| AI cost | Within the per-user monthly budget set in admin (default USD 0.50 per active user) |

## 9. Key decisions taken (with ADRs)

| Decision | ADR |
|---|---|
| Modular monolith in a pnpm/Turborepo monorepo | [ADR-001](../architecture/ADR/ADR-001-modular-monolith.md) |
| Next.js web + Expo React Native mobile with shared TypeScript packages | [ADR-002](../architecture/ADR/ADR-002-client-stack.md) |
| NestJS + Prisma + PostgreSQL 16 + Redis/BullMQ | [ADR-003](../architecture/ADR/ADR-003-backend-data-stack.md) |
| Deterministic engines; AI only explains and proposes via tools | [ADR-004](../architecture/ADR/ADR-004-deterministic-engines-ai-proposes.md) |
| Provider-independent AI gateway, Claude as default provider | [ADR-005](../architecture/ADR/ADR-005-ai-provider-gateway.md) |
| Managed identity provider (AWS Cognito); API validates its JWTs | [ADR-006](../architecture/ADR/ADR-006-authentication.md) |
| AWS `ap-south-1`, ECS Fargate first, Terraform | [ADR-007](../architecture/ADR/ADR-007-hosting.md) |
| Curated nutrition dataset with provenance and confidence | [ADR-008](../architecture/ADR/ADR-008-nutrition-data.md) |

## 10. Open questions for the product owner

These change scope or architecture. Defaults above are used until answered.

1. **Target market:** India-first (default) or global from launch? Changes data residency, food dataset priority, units and languages.
2. **Monetization at launch:** free beta (default) or paid tier at launch? Paid at launch adds App Store/Play billing and Razorpay/Stripe to MVP.
3. **Launch platforms:** web + Android + iOS together (default, one Expo codebase) or Android + web first? Android-first shortens store review and device testing.

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| AI gives unsafe advice | User harm, reputation | Deterministic engines, policy layer, red-team eval set, conservative refusals, human review queue |
| Nutrient data inaccuracy for Indian dishes | Wrong targets | IFCT-based dataset, recipe-derived composites, confidence labels, user corrections reviewed by admin |
| Scope creep (photos, wearables, payments) | Late MVP | Explicitly deferred; feature flags |
| Privacy breach of health data | Legal and trust | Minimisation, encryption, per-resource authorization tests, DPDP consent records |
| AI cost overrun | Margin | Per-user quotas, caching, effort tuning, cost dashboard and alerts |
| App store rejection (health claims) | Launch delay | No outcome guarantees, disclaimers, privacy labels prepared in Phase 6 |
