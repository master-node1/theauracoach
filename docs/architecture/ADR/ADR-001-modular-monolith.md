# ADR-001: Modular monolith in a pnpm/Turborepo monorepo

Status: Proposed · 2026-10-11

## Context
Greenfield product, small team, one region, strongly related domains (a meal log affects the dashboard, coach and adaptation). The sibling `the-aura-lab` repo uses microservices, which costs per-service pipelines, Terraform stacks and network hops.

## Options Considered
1. Microservices per domain.
2. Modular monolith (one API + one worker deployable) with enforced module boundaries.
3. Unstructured monolith.

## Decision
Option 2. One NestJS codebase, deployed as `api` and `worker` images. Modules expose application services and domain events only; boundaries are enforced with `eslint-plugin-boundaries` and per-module Prisma repositories. Repo layout:

```text
apps/api  apps/worker  apps/web  apps/mobile
packages/contracts  packages/domain  packages/ui  packages/ui-tokens  packages/config
infra/terraform  docs/
```

## Consequences
+ One deploy, one transaction scope, simple local dev.
+ Shared Zod contracts and pure domain functions reused by web and mobile.
− A noisy module can affect others; mitigated by the separate worker and per-route rate limits.
Extraction path: `ai-gateway` and `notifications` are the first candidates if scaling or team size demands it.

## Alternatives Rejected
Microservices (premature operational cost); unstructured monolith (erodes quickly).
