# notification-service

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | `notification_db` ([schema](prisma/schema.prisma)) |
| Local port | 3006 |
| Deployments | `notification-service-http` (`dist/main.http.js`), `notification-service-worker` (`dist/main.worker.js`) |

```bash
pnpm --filter @aura/notification-service build        # generates the Prisma client, then compiles
pnpm --filter @aura/notification-service test         # unit tests
pnpm --filter @aura/notification-service test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/notification-service db:migrate   # applies migrations to DATABASE_URL
```
