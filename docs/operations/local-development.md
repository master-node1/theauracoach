# Local Development

## Prerequisites

- Node.js 22 (`.nvmrc`) and pnpm 10 (`corepack enable` picks the version from `package.json`)
- Docker with Compose v2

## Run the whole stack

```bash
docker compose up --build
```

| What | Where |
|---|---|
| API gateway (the only entry point clients use) | http://localhost:8080 |
| dev-auth, a local stand-in for Cognito | http://localhost:4100 |
| Services, direct (debugging only) | profile 3001 · workout 3002 · nutrition 3003 · progress 3004 · coach 3005 · notification 3006 · audit 3007 |
| Postgres (one database and login role per service) | localhost:5432, user `postgres`, password `local-dev-only` |
| Redis (cache, jobs and event streams) | localhost:6379 |

Each service runs two containers from the same image, like in Kubernetes: `<name>` (HTTP) and `<name>-worker` (outbox relay, event consumers, jobs). The HTTP container applies its migrations before it starts.

Get a token and call the API:

```bash
TOKEN=$(curl -s -X POST localhost:4100/token -H 'content-type: application/json' \
  -d '{"sub":"0b6f5c1e-8f0a-4b8e-9c47-3d2a1e5f7a90","email":"me@example.com"}' | jq -r .access_token)
curl -s localhost:8080/v1/me -H "authorization: Bearer $TOKEN"
curl -s localhost:8080/v1/me/notification-preferences -H "authorization: Bearer $TOKEN"
```

`tools/smoke/compose-smoke.sh` runs exactly this check and is what CI runs against the stack.

To see traces and metrics as well, start the stack with `pnpm stack:observability` and open Grafana at http://localhost:3300. Every service log line inside a request has a `traceId` you can paste into Tempo. See [monitoring](monitoring.md).

dev-auth issues tokens shaped like Cognito access tokens (`token_use`, `client_id`, `cognito:groups`, plus the `email` claim our pre-token-generation trigger adds). Pass `"groups":["admin"]` to act as an admin. It also serves Cognito's hosted OAuth endpoints (`/oauth2/authorize` with a local sign-in form, `/oauth2/token` for the code and refresh grants, `/oauth2/revoke`, `/logout`) so the apps run the real sign-in flow. It refuses to start with `NODE_ENV=production`.

## Run the web app

```bash
docker compose up -d --build     # the API and dev-auth
pnpm install
pnpm --filter @aura/web... build # the shared packages the app imports
pnpm dev                         # web app on http://localhost:3100
```

Open http://localhost:3100 and press **Continue**. dev-auth shows a local sign-in form instead of Cognito's managed login: any email works, and **Staff (admin console)** puts you in the `admin` group so `/admin` opens. You land on Today, which shows your email from `GET /v1/me`.

The web app is a backend for frontend (ADR-006): `/api/auth/*` runs Authorization Code + PKCE, keeps the tokens in encrypted `__Host-session` and `__Host-refresh` cookies (HttpOnly, Secure, SameSite=Lax), refreshes them in `src/proxy.ts` when under 60 s remain, and `/api/v1/*` forwards to the gateway with the bearer token. Browser JavaScript never sees a token. Settings come from env with local defaults; see `apps/web/src/lib/config.ts` (`APP_URL`, `API_BASE_URL`, `OIDC_DOMAIN_URL`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`). A production build refuses to start without them.

Tests:

```bash
pnpm --filter @aura/web test     # BFF unit tests, using dev-auth's real OAuth handlers
pnpm --filter @aura/web build && pnpm --filter @aura/web e2e   # Playwright against the running stack
```

Set `DEV_AUTH_ACCESS_TOKEN_TTL=30` before `docker compose up` to make every request go through the refresh path, as CI does.

## Run the mobile app

```bash
docker compose up -d --build
pnpm --filter @aura/mobile... build
pnpm --filter @aura/mobile start # then press i (iOS simulator) or a (Android emulator)
```

The app signs in with `expo-auth-session` (Authorization Code + PKCE) against dev-auth and keeps tokens only in `expo-secure-store`. It reaches your machine at `localhost` from the iOS simulator and at `10.0.2.2` from the Android emulator. To point it elsewhere, set `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_OIDC_DOMAIN_URL` and `EXPO_PUBLIC_OIDC_CLIENT_ID` (read in `app.config.ts`). On a physical phone, use your machine's LAN address for both. Native simulator builds come with EAS; CI checks the app with `expo export`.

## Work on one service without Docker images

Start only the infrastructure, then run the service from source:

```bash
docker compose up -d postgres redis dev-auth
pnpm install
pnpm --filter @aura/profile-service... build
cd services/profile-service
cp .env.example .env            # local values only; .env is git-ignored
set -a; . ./.env; set +a
pnpm db:migrate
pnpm start:http                  # and, in another shell, pnpm start:worker
```

## Tests

```bash
pnpm test                        # unit tests, no infrastructure needed
docker compose up -d postgres redis
export TEST_DATABASE_URL=postgresql://postgres:local-dev-only@localhost:5432/postgres
export TEST_REDIS_URL=redis://localhost:6379
pnpm test:int                    # integration and cross-service tests
```

Integration tests create a scratch database per suite, apply that service's real migrations, and drop it afterwards. `tests/e2e` boots profile-service and notification-service (HTTP and workers) in one process and follows `UserRegistered` across Redis Streams.

## Add a service

```bash
pnpm new-service <short-name> --port <local-port> [--schema <file.prisma>]
```

It creates `services/<short-name>-service` with the standard layout, Dockerfile, config, health checks, worker and an integration test, and never overwrites existing files. Then add its database to `infra/local/postgres-init.sh`, its containers to `docker-compose.yml`, its routes to `services/api-gateway`, and a row to the [service catalog](../architecture/service-catalog.md).

## Change a database schema

```bash
cd services/<name>
# edit prisma/schema.prisma, then:
DATABASE_URL=postgresql://postgres:local-dev-only@localhost:5432/<name>_db pnpm exec prisma migrate dev --name <change>
```

Only expand-style migrations ship with code; destructive changes ship one release later ([deployment architecture §4](../architecture/deployment-architecture.md#4-cicd-github-actions)).
