# audit-service

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | `audit_db` ([schema](prisma/schema.prisma)) |
| Local port | 3007 |
| Deployments | `audit-service-http` (`dist/main.http.js`), `audit-service-worker` (`dist/main.worker.js`) |

```bash
pnpm --filter @aura/audit-service build        # generates the Prisma client, then compiles
pnpm --filter @aura/audit-service test         # unit tests
pnpm --filter @aura/audit-service test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/audit-service db:migrate   # applies migrations to DATABASE_URL
```
