# ADR-003: NestJS, Prisma, PostgreSQL 16, Redis and BullMQ

Status: Proposed · 2026-10-11

## Context
Relational, constraint-heavy data (plans → sessions → sets; foods → nutrients → units). The owner already runs NestJS 10, Prisma 6, PostgreSQL 16 and Redis 7.

## Options Considered
NestJS + Prisma + Postgres; NestJS + TypeORM; Fastify + Drizzle; MongoDB.

## Decision
NestJS 11 + Prisma 6 + PostgreSQL 16 (RDS) + Redis 7 (ElastiCache) + BullMQ, used by every service. Each service owns one database (one RDS instance with a database and user per service in MVP) and its own Prisma schema; no cross-database queries. Raw SQL via `prisma.$queryRaw` (tagged templates only) for analytics and search. Migrations via `prisma migrate`, reviewed SQL checked in.

## Consequences
+ Familiar stack, typed queries, good migration story.
− Prisma has limited support for some Postgres features (partial indexes, generated columns); these go in hand-edited migration SQL and are documented in the data dictionary.

## Alternatives Rejected
MongoDB (weak integrity for plans/nutrition); TypeORM (weaker typing); Drizzle (less familiar to the owner).
