# AuraCoach

AI personal trainer and nutrition coaching platform for web, Android and iOS.

**Status:** discovery and design (Phases 1–3). No application code yet. Start with the [documentation index](docs/README.md), the [discovery report](docs/discovery/discovery-report.md) and the [delivery plan](docs/delivery/delivery-plan.md).

## Planned stack

| Layer | Choice |
|---|---|
| Web | Next.js + TypeScript |
| Mobile | Expo (React Native) + TypeScript |
| API | NestJS modular monolith, REST + OpenAPI, SSE for coach streaming |
| Data | PostgreSQL 16 (Prisma), Redis 7 + BullMQ, S3 |
| Identity | Amazon Cognito |
| AI | Provider-independent gateway; Anthropic Claude by default |
| Infra | AWS ap-south-1, ECS Fargate, Terraform, GitHub Actions |

Reasoning for each choice is in the [ADRs](docs/architecture/ADR/).

## Repository layout (from Phase 4)

```text
apps/api  apps/worker  apps/web  apps/mobile
packages/contracts  packages/domain  packages/ui  packages/ui-tokens  packages/config
infra/terraform  docs/
```

Setup, run, test and deploy instructions will be added with the Phase 4 foundation.

## License

MIT
