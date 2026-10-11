# Security and Privacy Architecture

Target: OWASP ASVS 4.0 Level 2, OWASP Mobile Top 10, OWASP Top 10 for LLM Applications. Legal frame: India DPDP Act 2023 and DPDP Rules 2025; GDPR-ready.

## 1. Data classification

| Class | Examples | Controls |
|---|---|---|
| Sensitive health | Screening answers, conditions, injuries, pregnancy, measurements, weight, progress photos, symptom chat text | Encrypted at rest (KMS), field-level encryption for free-text conditions, never in logs, AI only with consent and minimised |
| Personal | Email, display name, DOB, device tokens | Encrypted at rest, masked in admin support view |
| Behavioural | Workout logs, food logs, check-ins | Encrypted at rest, owner-only access |
| Content | Exercises, foods, recipes | Public read |
| Operational | Audit, usage, metrics | Pseudonymous user id |

## 2. Identity, sessions, tokens

- Cognito: access token 15 min, refresh token 30 days with rotation, revocation on password change and "log out all devices".
- Mobile tokens in `expo-secure-store` (Keychain / Keystore). Web tokens never reach JS: Next.js BFF sets `HttpOnly; Secure; SameSite=Lax` cookies and forwards bearer tokens server-side; CSRF protected by SameSite plus double-submit token on state-changing BFF routes.
- Admin: MFA (TOTP) mandatory, session 8 h max, step-up for destructive actions.
- Passwords handled by Cognito (no hashes in our DB). Password policy: min 10 chars, breached-password check.

## 3. Authorisation

- Guards: `JwtAuthGuard` → `RolesGuard` (permission strings) → `ConsentGuard` (e.g. coach requires `ai_coach` consent) → service-level ownership.
- Ownership enforced in repositories (`where: { id, userId }`), 404 on miss (no existence oracle). Prisma client extension throws if a query on an owned model lacks `userId` (except in `admin` module with `support:read` and audit).
- Coach tools derive `userId` from the request context only; tool schemas have no `userId` field.
- Integration tests assert cross-user access returns 404 for every owned resource (generated from the route table).

## 4. Input and output handling

- All DTOs validated with Zod (`packages/contracts`), unknown keys stripped, size limits (JSON 256 KB, upload 10 MB), numeric ranges (weight 25–350 kg, reps 0–100).
- Prisma parameterises queries; `$queryRaw` only with tagged templates; lint rule forbids `$queryRawUnsafe`.
- Output encoding: React escapes by default; coach Markdown rendered with a sanitising renderer (no raw HTML, links restricted to allow-listed domains).
- Security headers via Helmet and Next.js config: CSP with nonces, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- SSRF: no user-supplied URLs fetched server-side; Open Food Facts calls via fixed base URL.

## 5. Rate limiting and abuse

| Scope | Limit |
|---|---|
| Auth endpoints (BFF) | 10/min per IP, 5 failed logins per account per 15 min (Cognito advanced security) |
| General API | 300/min per user, 1000/min per IP |
| Search | 60/min per user |
| Coach messages | 10/min, 30/day per user (configurable per plan) |
| Uploads | 20/day per user |

Redis sliding-window limiter; responses `429` with `Retry-After`. WAF managed rule groups and bot control at edge.

## 6. Secrets and environments

- AWS Secrets Manager per environment; injected into ECS tasks as secrets; rotated (DB 90 days).
- GitHub Actions uses OIDC role assumption; no static AWS keys. Secret scanning (GitHub push protection + gitleaks in CI).
- `.env.example` documents names only. Production data never copied to lower environments; staging uses synthetic data.

## 7. Encryption

TLS 1.2+ everywhere (ACM certs); RDS, ElastiCache, S3 encrypted with KMS CMKs; field-level encryption (AES-256-GCM via KMS data keys) for `HealthCondition.notes` and `ScreeningResponse.freeText`. Progress photos (P2) in a separate bucket with per-object SSE-KMS, short-lived signed URLs (5 min), no CDN caching.

## 8. AI-specific controls (OWASP LLM Top 10)

| Risk | Control |
|---|---|
| Prompt injection (direct and via food names, notes) | User content placed only in user turns, wrapped and labelled as data; tool allow-list; no tool can act on another user; write tools only create proposals |
| Sensitive data disclosure | Context builder sends minimum fields; pseudonymous ids; no email, DOB (age band only), no photos |
| Excessive agency | Max 6 tool rounds, per-tool rate limits, proposals require user confirmation and engine re-validation |
| Hallucinated facts | Nutrient values and loads only from tool results; post-check rejects numbers not present in tool outputs for nutrient claims |
| Unsafe advice | Pre and post safety classification, red-flag templates, eval suite gates prompt releases |
| Denial of wallet | Per-user and global budgets, max tokens per feature, kill switch |
| Supply chain | Pinned model ids per feature in config; provider changes go through eval |

## 9. Privacy operations (DPDP)

- Notice and consent at onboarding per purpose; consent records with version, timestamp, channel; withdrawal as easy as giving.
- Data principal rights: access/export (JSON+CSV), correction (profile edits), erasure (30-day grace), grievance contact in app; nomination support documented.
- Retention: see [data dictionary](../database/data-dictionary.md#retention).
- Breach response: runbook in `operations/` (Phase 4), notify Data Protection Board and users per DPDP Rules timelines.
- Children: DPDP treats under-18s as children. MVP is **18+ only**; a verifiable parental-consent flow for 16–17 can be added after legal review.

## 10. Security testing

SAST (CodeQL, Semgrep), dependency audit (`pnpm audit`, Dependabot), secret scanning, container scanning (Trivy), DAST (OWASP ZAP baseline on staging), authz matrix tests, AI red-team suite, annual external pentest before public launch.
