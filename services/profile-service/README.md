# profile-service

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | `profile_db` ([schema](prisma/schema.prisma)) |
| Local port | 3001 |
| Deployments | `profile-service-http` (`dist/main.http.js`), `profile-service-worker` (`dist/main.worker.js`) |

```bash
pnpm --filter @aura/profile-service build        # generates the Prisma client, then compiles
pnpm --filter @aura/profile-service test         # unit tests
pnpm --filter @aura/profile-service test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/profile-service db:migrate   # applies migrations to DATABASE_URL
```
