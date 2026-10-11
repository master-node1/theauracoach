# progress-service

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | `progress_db` ([schema](prisma/schema.prisma)) |
| Local port | 3004 |
| Deployments | `progress-service-http` (`dist/main.http.js`), `progress-service-worker` (`dist/main.worker.js`) |

```bash
pnpm --filter @aura/progress-service build        # generates the Prisma client, then compiles
pnpm --filter @aura/progress-service test         # unit tests
pnpm --filter @aura/progress-service test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/progress-service db:migrate   # applies migrations to DATABASE_URL
```
