# Authentication and Authorisation — Low-Level Design

Service: **profile-service (user provisioning, roles) and `packages/service-kit` (guards used by every service)** · see the [service catalog](../../architecture/service-catalog.md) for owned data, events and allowed calls.

See [ADR-006](../../architecture/ADR/ADR-006-authentication.md) and [security architecture](../../architecture/security-architecture.md).

## 1. Components

```text
packages/service-kit/src/auth/       # used by every service
  user-token.verifier.ts             # jose: RS256 via the pool JWKS (cached 1 h), iss, exp, token_use, client_id
  auth.guard.ts                      # global: @Public() → open, @InternalOnly(...) → service token, else user token
  service-token.ts                   # mints and verifies service JWTs for /internal/v1 routes
  decorators.ts                      # Public, InternalOnly, CurrentUser, CallingService
  (Phase 5) permissions.guard.ts consent.guard.ts
packages/contracts/src/auth/permissions.ts   # role → permission map shared by all services
services/profile-service/src/identity/
  user-provisioning.service.ts       # first-call User creation, publishes UserRegistered
  me.controller.ts                   # GET /v1/me
  (Phase 5) roles.service.ts         # grants/revokes roles, mirrors to Cognito groups, audits
apps/web/app/api/auth/*              # BFF: login, callback, refresh, logout (Next.js route handlers)
apps/mobile/src/auth/                # expo-auth-session + expo-secure-store
```

Consent checks: profile-service publishes `ConsentChanged`; coach-service and notification-service keep a local consent replica so `ConsentGuard` needs no sync call.

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
  A->>A: profile-service upserts User by sub (first call)
  A-->>M: profile + onboarding state
```

Web: the same code flow handled by the BFF; cookies `__Host-session` (encrypted, HttpOnly, Secure, SameSite=Lax). BFF proxies `/api/v1/*` to the API attaching the bearer token, refreshing when < 60 s left.

Email sign-up and password reset use Cognito `SignUp`, `ConfirmSignUp`, `ForgotPassword`, `ConfirmForgotPassword` from our own screens (BFF on web, direct SDK on mobile). Reset codes expire in 15 min, single use.

Log out all devices: `POST /v1/me/sessions/revoke` → Cognito `GlobalSignOut` + API deny-list of `jti`/`origin_jti` in Redis until expiry.

## 3. User identity across services

The AuraCoach user id **is** the Cognito `sub` (a UUID). profile-service creates `User` with `id = sub` on the first call, and every other service keys its rows by the token's `sub` directly, so no service needs a lookup call to find "who is this". `User.cognitoSub` is stored separately so a future identity-provider migration can remap logins without changing ids. Access tokens must carry `email`, added by a Cognito pre-token-generation trigger (V2); without it profile-service refuses to create the account (`403 EMAIL_CLAIM_MISSING`). The verifier rejects tokens whose `sub` is not a UUID.

## 4. Authorisation

- Default deny: every route requires auth unless `@Public()`.
- `@Permissions('exercise:publish')` checked by `PermissionsGuard` from the token's `cognito:groups` claim through the shared permission map. profile-service is the source of truth for grants and keeps Cognito groups in sync; a revoked role takes effect at the next token refresh (≤ 15 min), and role revocation also triggers `GlobalSignOut` for admin roles.
- Admin routes additionally require token `amr` to include MFA; else `403 MFA_REQUIRED`.
- Ownership in repositories; 404 for non-owned.
- Permission catalogue (MVP): `exercise:*`, `food:*`, `recipe:*`, `template:*`, `prompt:*`, `policy:*`, `review:*`, `feedback:read`, `usage:read`, `audit:read`, `role:grant`, `user:support_read`.

## 5. Errors

`401 UNAUTHENTICATED` (missing/invalid/expired token), `403 FORBIDDEN`, `403 MFA_REQUIRED`, `403 CONSENT_REQUIRED` (with `purpose`), `423 ACCOUNT_PENDING_DELETION`.

## 6. Tests

JWT verification with locally signed test keys (wrong issuer, audience, expired, `id` token instead of `access`); guard matrix generated from route metadata; BFF CSRF and cookie flags; refresh rotation; revoked token rejected.
