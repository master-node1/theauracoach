#!/usr/bin/env node
// Scaffolds services/<name>-service with the standard layout (platform LLD §1).
// Usage: pnpm new-service <short-name> --port <local-port> [--schema <path-to-schema.prisma>]
// Never overwrites existing files, so it is safe to re-run.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const short = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!short || !/^[a-z][a-z-]*$/.test(short)) {
  console.error('Usage: pnpm new-service <short-name> --port <port> [--schema <file>]');
  process.exit(1);
}
const name = `${short}-service`;
const port = Number(flag('port') ?? 3000);
const dir = join(root, 'services', name);
const db = `${short.replace(/-/g, '_')}_db`;
const created = [];

function write(rel, content) {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  try {
    // 'wx' fails if the file exists, so existing files are never overwritten (and there is no check-then-write race).
    writeFileSync(path, content.replace(/^\n/, ''), { flag: 'wx' });
    created.push(rel);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

const schemaHeader = `// ${name} Prisma schema. This service owns only its own database (${db}).
// References to other services' data are plain id columns (no foreign keys);
// deletion arrives via the AccountDeleted event. Design: docs/architecture/service-catalog.md
`;
const generator = `generator client {
  provider        = "prisma-client-js"
  output          = "../src/generated/prisma"
  previewFeatures = ["postgresqlExtensions"]
  binaryTargets   = ["native", "debian-openssl-3.0.x"]
}`;

function schema() {
  const from = flag('schema');
  if (!from) {
    return `${schemaHeader}
${generator}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model OutboxEvent {
  id          String    @id @default(uuid()) @db.Uuid
  type        String    @db.VarChar(60)
  version     Int       @default(1)
  userId      String?   @db.Uuid
  payload     Json
  traceparent String?
  createdAt   DateTime  @default(now())
  publishedAt DateTime?
  attempts    Int       @default(0)
  lastError   String?

  @@index([publishedAt, createdAt])
}

model ProcessedEvent {
  eventId     String   @id
  type        String   @db.VarChar(60)
  processedAt DateTime @default(now())
}
`;
  }
  let text = readFileSync(resolve(from), 'utf8');
  text = text.replace(/^(\/\/.*\n)+/, schemaHeader);
  text = text.replace(/generator client \{[^}]*\}/, generator);
  return text;
}

write(
  'package.json',
  `
{
  "name": "@aura/${name}",
  "version": "0.1.0",
  "private": true,
  "files": ["dist", "prisma"],
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate deploy",
    "build": "tsc -p tsconfig.build.json && rm -rf dist/generated && cp -R src/generated dist/generated",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src test",
    "test": "vitest run --passWithNoTests --exclude 'test/**/*.int.test.ts'",
    "test:int": "vitest run test/*.int.test.ts",
    "start:http": "node dist/main.http.js",
    "start:worker": "node dist/main.worker.js"
  },
  "dependencies": {
    "@aura/contracts": "workspace:*",
    "@aura/service-kit": "workspace:*",
    "@nestjs/common": "11.2.7",
    "@nestjs/core": "11.2.7",
    "@nestjs/platform-express": "11.2.7",
    "@prisma/client": "6.19.3",
    "prisma": "6.19.3",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "zod": "4.6.6"
  },
  "devDependencies": {
    "@aura/testing": "workspace:*",
    "@nestjs/testing": "11.2.7",
    "@swc/core": "1.16.18",
    "@types/supertest": "7.2.1",
    "supertest": "7.3.1",
    "unplugin-swc": "2.0.0",
    "vitest": "3.2.7"
  }
}
`,
);

write(
  'tsconfig.json',
  `
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true, "types": ["node"] },
  "include": ["src", "test"]
}
`,
);
write(
  'tsconfig.build.json',
  `
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] },
  "include": ["src"]
}
`,
);
write(
  'vitest.config.ts',
  `
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC keeps decorator metadata, which Nest dependency injection needs.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { environment: 'node', testTimeout: 20000, hookTimeout: 60000 },
});
`,
);
write('prisma/schema.prisma', schema());
write(
  'src/config.ts',
  `
import { baseEnvSchema, loadConfig } from '@aura/service-kit';

/** ${name} has no settings beyond the shared ones yet. Extend the schema here when it does. */
export const configSchema = baseEnvSchema;
export type ServiceConfig = ReturnType<typeof configSchema.parse>;

export function loadServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return loadConfig(configSchema, env);
}
`,
);
write(
  'src/prisma.service.ts',
  `
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HealthRegistry, SERVICE_KIT_CONFIG, type BaseConfig } from '@aura/service-kit';
import { PrismaClient } from './generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly health: HealthRegistry,
    @Inject(SERVICE_KIT_CONFIG) config: BaseConfig,
  ) {
    super({ datasources: { db: { url: config.DATABASE_URL } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.health.register('database', async () => {
      await this.$queryRaw\`SELECT 1\`;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
`,
);
write(
  'src/app.module.ts',
  `
import { DynamicModule, Module } from '@nestjs/common';
import { ServiceKitModule, type UserTokenVerifier } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { PrismaService } from './prisma.service';

/** The http deployment: public /v1 and /internal/v1 routes. */
@Module({})
export class AppModule {
  static register(config: ServiceConfig, verifier?: UserTokenVerifier): DynamicModule {
    return {
      module: AppModule,
      imports: [ServiceKitModule.forRoot({ config, ...(verifier ? { verifier } : {}) })],
      controllers: [],
      providers: [PrismaService],
    };
  }
}
`,
);
write(
  'src/worker.module.ts',
  `
import { DynamicModule, Module } from '@nestjs/common';
import { EVENT_DATABASE, EVENT_SUBSCRIPTIONS, EventWorker, ServiceKitModule } from '@aura/service-kit';
import type { ServiceConfig } from './config';
import { PrismaService } from './prisma.service';

/** The worker deployment: outbox relay, event consumers and scheduled jobs. */
@Module({})
export class WorkerModule {
  static register(config: ServiceConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ServiceKitModule.forRoot({ config })],
      providers: [
        PrismaService,
        { provide: EVENT_DATABASE, useExisting: PrismaService },
        { provide: EVENT_SUBSCRIPTIONS, useValue: [] },
        EventWorker,
      ],
    };
  }
}
`,
);
write(
  'src/main.http.ts',
  `
import 'reflect-metadata';
import { bootstrapHttp } from '@aura/service-kit';
import { AppModule } from './app.module';
import { loadServiceConfig } from './config';

const config = loadServiceConfig();
void bootstrapHttp(AppModule.register(config), config.PORT);
`,
);
write(
  'src/main.worker.ts',
  `
import 'reflect-metadata';
import { bootstrapWorker } from '@aura/service-kit';
import { loadServiceConfig } from './config';
import { WorkerModule } from './worker.module';

void bootstrapWorker(WorkerModule.register(loadServiceConfig()));
`,
);
write(
  'test/app.int.test.ts',
  `
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureHttpApp, UserTokenVerifier } from '@aura/service-kit';
import { createDevIssuer, createTestDatabase, DEV_CLIENT_ID, testEnv, type TestDatabase } from '@aura/testing';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';

let db: TestDatabase;
let app: INestApplication;

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), '${short}');
  const dev = await createDevIssuer();
  const config = loadServiceConfig(testEnv({ service: '${name}', databaseUrl: db.url, issuer: dev.issuer }));
  const verifier = new UserTokenVerifier({ jwksUrl: config.AUTH_JWKS_URL, issuer: dev.issuer, clientIds: [DEV_CLIENT_ID], keySource: dev.keySource });
  const ref = await Test.createTestingModule({ imports: [AppModule.register(config, verifier)] }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('${name}', () => {
  it('is ready once its database and Redis answer', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('answers unknown routes with a problem document', async () => {
    const res = await request(app.getHttpServer()).get('/v1/does-not-exist').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
`,
);
write(
  'Dockerfile',
  `
# Build from the repository root: docker build -f services/${name}/Dockerfile .
FROM node:22.22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable \\
  && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \\
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@aura/${name}...
RUN pnpm --filter=@aura/${name} deploy --prod --legacy /out

FROM node:22.22-bookworm-slim AS runtime
# Patch OS packages, and drop npm and corepack: the runtime never installs anything,
# and npm's bundled dependencies are the image's main source of scanner findings.
RUN apt-get update && apt-get upgrade -y \\
  && apt-get install -y --no-install-recommends openssl ca-certificates \\
  && rm -rf /var/lib/apt/lists/* \\
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \\
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# The worker deployment overrides the command with: node dist/main.worker.js
# The migration job runs: node_modules/.bin/prisma migrate deploy
CMD ["node", "dist/main.http.js"]
`,
);
write(
  '.env.example',
  `
# Local development values only. Real values come from AWS Secrets Manager via External Secrets.
SERVICE_NAME=${name}
PORT=${port}
LOG_LEVEL=info
DATABASE_URL=postgresql://${short.replace(/-/g, '_')}_svc:local-dev-only@localhost:5432/${db}
REDIS_URL=redis://localhost:6379
AUTH_JWKS_URL=http://localhost:4100/.well-known/jwks.json
AUTH_ISSUER=http://localhost:4100
AUTH_CLIENT_IDS=aura-dev-client
INTERNAL_TOKEN_SECRET=local-dev-only-internal-secret-change-me
INTERNAL_SERVICE_URLS=
`,
);
write(
  'README.md',
  `
# ${name}

What this service owns, exposes, publishes and consumes is in the [service catalog](../../docs/architecture/service-catalog.md).

| | |
|---|---|
| Database | \`${db}\` ([schema](prisma/schema.prisma)) |
| Local port | ${port} |
| Deployments | \`${name}-http\` (\`dist/main.http.js\`), \`${name}-worker\` (\`dist/main.worker.js\`) |

\`\`\`bash
pnpm --filter @aura/${name} build        # generates the Prisma client, then compiles
pnpm --filter @aura/${name} test         # unit tests
pnpm --filter @aura/${name} test:int     # needs TEST_DATABASE_URL and TEST_REDIS_URL
pnpm --filter @aura/${name} db:migrate   # applies migrations to DATABASE_URL
\`\`\`
`,
);

console.log(
  created.length
    ? `Created in services/${name}:\n  ${created.join('\n  ')}`
    : 'Nothing to do: all files exist.',
);
