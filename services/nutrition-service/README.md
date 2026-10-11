# nutrition-service

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | `nutrition_db` ([schema](prisma/schema.prisma)) |
| Local port | 3003 |
| Deployments | `nutrition-service-http` (`dist/main.http.js`), `nutrition-service-worker` (`dist/main.worker.js`) |

```bash
pnpm --filter @aura/nutrition-service build        # generates the Prisma client, then compiles
pnpm --filter @aura/nutrition-service test         # unit tests
pnpm --filter @aura/nutrition-service test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/nutrition-service db:migrate   # applies migrations to DATABASE_URL
```
