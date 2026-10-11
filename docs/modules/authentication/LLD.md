# Authentication and Authorisation — Low-Level Design

See [ADR-006](../../architecture/ADR/ADR-006-authentication.md) and [security architecture](../../architecture/security-architecture.md).

## 1. Components

```text
apps/api/src/modules/identity/
  jwt.strategy.ts            # aws-jwt-verify, JWKS cached 1 h
  guards/ jwt-auth.guard.ts roles.guard.ts consent.guard.ts
  decorators/ public.ts permissions.ts current-user.ts
  user-provisioning.service.ts
  permissions.service.ts     # role → permission map cached in Redis 10 min
apps/web/app/api/auth/*      # BFF: login, callback, refresh, logout (Next.js route handlers)
apps/mobile/src/auth/        # expo-auth-session + expo-secure-store
```

## 2. Flows

```mermaid
sequenceDiagram
  participant M as Mobile app
  participant C as Cognito
  participant A as API
  M->>C: Authorization Code + PKCE (Google / Apple / email)
  C-->>M: code
  M->>C: exchange code (+ code_verifier)
  C-->>M: id, access (15 min), refresh (30 d, rotating)
  M->>A: GET /v1/me (Bearer access)
  A->>A: verify JWT (iss, aud/client_id, exp, token_use=access)
  A->>A: upsert User by sub (first call)
  A-->>M: profile + onboarding state
```

Web: the same code flow handled by the BFF; cookies `__Host-session` (encrypted, HttpOnly, Secure, SameSite=Lax). BFF proxies `/api/v1/*` to the API attaching the bearer token, refreshing when < 60 s left.

Email sign-up and password reset use Cognito `SignUp`, `ConfirmSignUp`, `ForgotPassword`, `ConfirmForgotPassword` from our own screens (BFF on web, direct SDK on mobile). Reset codes expire in 15 min, single use.

Log out all devices: `POST /v1/me/sessions/revoke` → Cognito `GlobalSignOut` + API deny-list of `jti`/`origin_jti` in Redis until expiry.

## 3. Authorisation

- Default deny: every route requires auth unless `@Public()`.
- `@Permissions('exercise:publish')` checked by `RolesGuard` against DB roles (not only Cognito groups).
- Admin routes additionally require token `amr` to include MFA; else `403 MFA_REQUIRED`.
- Ownership in repositories; 404 for non-owned.
- Permission catalogue (MVP): `exercise:*`, `food:*`, `recipe:*`, `template:*`, `prompt:*`, `policy:*`, `review:*`, `feedback:read`, `usage:read`, `audit:read`, `role:grant`, `user:support_read`.

## 4. Errors

`401 UNAUTHENTICATED` (missing/invalid/expired token), `403 FORBIDDEN`, `403 MFA_REQUIRED`, `403 CONSENT_REQUIRED` (with `purpose`), `423 ACCOUNT_PENDING_DELETION`.

## 5. Tests

JWT verification with locally signed test keys (wrong issuer, audience, expired, `id` token instead of `access`); guard matrix generated from route metadata; BFF CSRF and cookie flags; refresh rotation; revoked token rejected.
