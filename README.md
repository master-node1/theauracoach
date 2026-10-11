# AuraCoach

AI personal trainer and nutrition coaching platform for web, Android and iOS.

**Status:** Phase 4 foundation in progress ([delivery plan](docs/delivery/delivery-plan.md)). The backend skeleton runs: seven services, the gateway, shared packages and CI. Product features start in Phase 5. Design docs start at the [documentation index](docs/README.md).

## Planned stack

| Layer | Choice |
|---|---|
| Web | Next.js + TypeScript |
| Mobile | Expo (React Native) + TypeScript |
| Backend | 7 NestJS microservices behind an nginx gateway, one repo; REST + OpenAPI, SSE for coach streaming; events over Redis Streams |
| Data | PostgreSQL 16 with one database per service (Prisma), Redis 7 + BullMQ, S3 |
| Identity | Amazon Cognito |
| AI | Provider-independent gateway; Anthropic Claude by default |
| Infra | AWS ap-south-1, EKS + Helm, Terraform, GitHub Actions with per-service builds |

Reasoning for each choice is in the [ADRs](docs/architecture/ADR/); what each service owns is in the [service catalog](docs/architecture/service-catalog.md).

## Repository layout

```text
services/api-gateway  services/profile-service  services/workout-service  services/nutrition-service
services/progress-service  services/coach-service  services/notification-service  services/audit-service
apps/web  apps/mobile
packages/contracts  packages/domain  packages/service-kit  packages/api-client  packages/ui  packages/ui-tokens
tools/dev-auth  tools/testing  tools/scaffold  tests/e2e
infra/local  docs/
```

`apps/web`, `apps/mobile`, `infra/helm` and `infra/terraform` arrive in later Phase 4 pull requests.

## Quick start

```bash
corepack enable
pnpm install
docker compose up --build        # gateway on http://localhost:8080
```

Tests, running a single service and adding a service: [local development](docs/operations/local-development.md). Engineering rules: [AGENTS.md](AGENTS.md).

## License

MIT
