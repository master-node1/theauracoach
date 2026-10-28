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

## Food catalogue (TAC-14)

Curated content is in [content/nutrition](content/nutrition) and validated by `pnpm --filter @aura/nutrition-service test`. Load it, or reference data, into a database with:

```bash
pnpm --filter @aura/nutrition-service build
DATABASE_URL=... pnpm nutrition:import curated --dry-run          # print the diff only
DATABASE_URL=... pnpm nutrition:import curated                    # imports for review (IN_REVIEW)
DATABASE_URL=... pnpm nutrition:import fdc --dir ./FoodData_Central_csv
DATABASE_URL=... pnpm nutrition:import ifct --file ./ifct2017.csv  # licensed, supplied by the owner
```

Imports are idempotent and never change published curated items in place (changes wait as a revision for review). Details: [nutrition LLD](../../docs/modules/nutrition/LLD.md) §4–§7.
