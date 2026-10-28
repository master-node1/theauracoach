# workout-service

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | `workout_db` ([schema](prisma/schema.prisma)) |
| Local port | 3002 |
| Deployments | `workout-service-http` (`dist/main.http.js`), `workout-service-worker` (`dist/main.worker.js`) |

```bash
pnpm --filter @aura/workout-service build        # generates the Prisma client, then compiles
pnpm --filter @aura/workout-service test         # unit tests
pnpm --filter @aura/workout-service test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/workout-service db:migrate   # applies migrations to DATABASE_URL
```

## Content library

Exercises and templates move through `DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED` under `/v1/admin/exercises` and `/v1/admin/templates`; the published library is served at `/v1/exercises` ([workouts LLD §9a](../../docs/modules/workouts/LLD.md)). The starter dataset lives in [content/workouts](../../content/workouts/README.md).

```bash
pnpm --filter @aura/workout-service build
DATABASE_URL=postgresql://workout_svc:local-dev-only@localhost:5432/workout_db pnpm content:import --dry-run   # show the diff
DATABASE_URL=... pnpm content:import            # import as IN_REVIEW (what a shared environment gets)
DATABASE_URL=... pnpm content:import --publish  # local and dev seed: also publish, so plans can be generated
```
