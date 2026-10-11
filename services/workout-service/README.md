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
