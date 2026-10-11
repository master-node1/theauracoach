# Test Strategy

## 1. Pyramid and tooling

| Level | Scope | Tooling | Runs |
|---|---|---|---|
| Unit — domain | Pure engines in `packages/domain` (targets, plans, progression, units, trends) | Vitest, fast-check (property tests) | Every PR, < 60 s |
| Unit — application | Nest services with fake ports | Vitest + `@nestjs/testing` | Every PR |
| Contract | Zod ↔ OpenAPI sync, generated client compiles, Spectral/Redocly lint, breaking-change diff (`oasdiff`) | Redocly, oasdiff | Every PR |
| Contract — services | Event payloads validated against `packages/contracts` schemas by producer and consumer tests; internal APIs covered by consumer-driven pacts (coach → workout/nutrition/progress, profile → workout/nutrition); a consumer may not deploy against a provider version that breaks its pact | Vitest + Pact | Every PR touching a service or `packages/contracts` |
| Integration — service | One service: controller → application → Prisma → its own Postgres database and Redis; other services stubbed via `InternalClient` fakes | Supertest, Testcontainers (Postgres 16, Redis 7), WireMock for OFF/Expo/AI | Every PR |
| Saga and events | Onboarding saga, account deletion and export fan-out run across all services in docker compose; redelivered events are processed once; DLQ after 5 attempts | Vitest + compose | Nightly and before release |
| Database | Each service's migrations apply cleanly from zero and from previous release; constraints enforced; drift check | Prisma migrate + Testcontainers | Every PR |
| Frontend components | UI components, hooks, forms, states | Vitest + Testing Library (web), Jest + RNTL (mobile) | Every PR |
| Accessibility | axe on every web route; RN accessibility props lint; manual VoiceOver/TalkBack checklist per release | axe-core/Playwright, eslint-plugin-react-native-a11y | PR (auto), release (manual) |
| E2E web | Critical journeys | Playwright against dev/staging | Merge to main, release |
| E2E mobile | Critical journeys on iOS simulator + Android emulator; device farm smoke | Maestro, EAS + Firebase Test Lab | Nightly, release |
| BDD | Business scenarios from [acceptance-criteria.md](../requirements/acceptance-criteria.md) | Cucumber.js step definitions over the API | Every PR (tagged @critical), full nightly |
| Security | SAST, deps, secrets, containers, DAST, authz matrix | CodeQL, Semgrep, gitleaks, Trivy, OWASP ZAP | PR / nightly / release |
| AI evals | Correctness, safety, adherence, injection, leakage, hallucination, tone | `evals/` runner, programmatic graders + LLM judge | Prompt/model change, nightly sample |
| Performance | API load, SSE concurrency, DB query plans | k6, `EXPLAIN ANALYZE` snapshots | Release (staging) |
| Regression | All of the above on release branch | — | Release |

Coverage targets are guidance, not gates: domain ≥ 95% branches, application ≥ 80%. Gates are: all tests green, no new critical/high vulnerabilities, axe zero serious violations, eval thresholds, p95 budgets in k6.

## 2. Test data

- Deterministic seed: 20 synthetic personas (incl. Priya, Arjun, Meena variants, edge cases: BMI 40, 18-year-old, pregnant, vegan + nut allergy, Jain, shift worker).
- Food fixture subset (300 foods incl. raw/cooked pairs and household units) and exercise fixture (120 exercises).
- `FixedClock` and timezone matrix (Asia/Kolkata, America/New_York, Pacific/Auckland) for date-boundary tests.
- No production data in any test environment.

## 3. Authorisation matrix

A generator reads Nest route metadata and, for every route with an owned resource, creates tests: owner → 2xx; other user → 404; unauthenticated → 401; wrong role on admin → 403; missing MFA on admin → 403. New routes without a matrix entry fail CI.

## 4. AI testing

- Unit: orchestrator with `FakeAdapter` scripted tool calls (including malicious inputs: other user ids, oversized payloads, unknown tools).
- Integration: tool executor with real services on Testcontainers.
- Evals: see [ai-coach LLD §10](../modules/ai-coach/LLD.md#10-evaluation); thresholds gate prompt publication and model-config changes.
- Chaos: provider 500/429/timeouts/refusal injected via adapter decorator; assert core endpoints unaffected and fallback shown.

## 5. Mobile specifics

Offline: airplane-mode tests for session logging and food logging, sync on reconnect, conflict cases. OS matrix: iOS 16/17/18, Android 9/12/14/15; small (360 dp) and large screens; dynamic type 200%; dark mode.

## 6. Non-functional budgets checked in CI/release

| Budget | Threshold |
|---|---|
| API p95 (non-AI) at 200 rps | < 400 ms |
| Dashboard cold | < 400 ms p95 |
| Coach first token | < 3 s p95 (staging, real provider) |
| Web LCP (Moto G-class, 4G) | < 2.5 s |
| JS bundle (web initial) | < 200 KB gz |
| Mobile cold start (mid Android) | < 2.5 s |

## 7. Definition of Done (testing view)

Unit + integration for new logic; BDD for new business rule; authz matrix updated; E2E for changed critical journey; a11y checks pass; docs updated.
