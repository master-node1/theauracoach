# coach-service

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | `coach_db` ([schema](prisma/schema.prisma)) |
| Local port | 3005 |
| Deployments | `coach-service-http` (`dist/main.http.js`), `coach-service-worker` (`dist/main.worker.js`) |

```bash
pnpm --filter @aura/coach-service build        # generates the Prisma client, then compiles
pnpm --filter @aura/coach-service test         # unit tests
pnpm --filter @aura/coach-service test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/coach-service db:migrate   # applies migrations to DATABASE_URL
```
