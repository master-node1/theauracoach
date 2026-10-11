# ADR-001: Microservices in one monorepo

Status: Accepted (product owner, 2026-10-11) · Supersedes the earlier draft that proposed a modular monolith

## Context
The product owner wants AuraCoach built as microservices in a single repository, consistent with `the-aura-lab`, so that services deploy and scale independently and the team reuses the same CI/CD, Helm and Terraform patterns. The domains (profile, training, nutrition, progress, coaching, notifications) have clear owners of data and rules.

## Options Considered
1. Modular monolith (one API + worker) with extractable modules.
2. A few coarse services (core API + coach/AI service).
3. Domain microservices in one monorepo, each with its own database, image and Helm release.
4. Microservices in separate repositories.

## Decision
Option 3. Eight deployables under `services/` (api-gateway, profile, workout, nutrition, progress, coach, notification, audit), web and mobile under `apps/`, shared code in workspace `packages/` (pnpm workspaces + Turborepo). Boundaries, ownership and allowed calls are defined in the [service catalog](../service-catalog.md). Each service has its own Postgres database, Prisma schema and migrations, Dockerfile, Helm values and per-service docs.

## Consequences
+ Independent deploys and scaling (coach and nutrition search scale separately from profile).
+ Failure isolation: a coach outage cannot take down logging.
+ Same operating model as the-aura-lab (changed-service CI, generic Helm chart, Terraform per service).
− Distributed-system costs: events, idempotent consumers, sagas, eventual consistency on the dashboard, contract tests, more infrastructure and observability work.
− Data duplication through replicas (e.g. nutrition keeps a copy of the diet profile).
Mitigations: one monorepo with shared contracts and `service-kit`, a strict rule that only documented sync calls exist, outbox for every event, and tracing across services from day one.

## Alternatives Rejected
Modular monolith (simpler, but not the owner's chosen operating model and couples deploys); coarse split (does not give per-domain ownership); separate repos (duplicated contracts and tooling, harder atomic changes).
