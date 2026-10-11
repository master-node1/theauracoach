# AuraCoach

AI personal trainer and nutrition coaching platform for web, Android and iOS.

**Status:** discovery and design (Phases 1–3). No application code yet. Start with the [documentation index](docs/README.md), the [discovery report](docs/discovery/discovery-report.md) and the [delivery plan](docs/delivery/delivery-plan.md).

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

## Repository layout (from Phase 4)

```text
services/api-gateway  services/profile-service  services/workout-service  services/nutrition-service
services/progress-service  services/coach-service  services/notification-service  services/audit-service
apps/web  apps/mobile
packages/contracts  packages/domain  packages/service-kit  packages/api-client  packages/ui  packages/ui-tokens
infra/terraform  infra/helm  docs/
```

Setup, run, test and deploy instructions will be added with the Phase 4 foundation.

## License

MIT
