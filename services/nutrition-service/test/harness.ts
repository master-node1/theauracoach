import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureHttpApp, UserTokenVerifier } from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { resolve } from 'node:path';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';
import { PrismaService } from '../src/prisma.service';

export interface Harness {
  app: INestApplication;
  db: TestDatabase;
  dev: DevIssuer;
  prisma: PrismaService;
  close(): Promise<void>;
}

/** Boots the http app on a scratch database. Each suite passes its own Redis db. */
export async function bootApp(label: string, redisDb: number): Promise<Harness> {
  const db = await createTestDatabase(resolve(__dirname, '..'), label);
  const dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'nutrition-service', databaseUrl: db.url, issuer: dev.issuer, redisDb }),
  );
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier)],
  }).compile();
  const app = configureHttpApp(ref.createNestApplication());
  await app.init();
  const prisma = app.get(PrismaService);
  return {
    app,
    db,
    dev,
    prisma,
    async close() {
      await app.close();
      await db.drop();
    },
  };
}

/** Marks everything a nutritionist would sign off as published (what TAC-44 review does). */
export async function publishAll(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "FoodItem" SET status = 'PUBLISHED', "reviewRequired" = NULL, "publishedAt" = now()
    WHERE source <> 'USER' AND status = 'IN_REVIEW'`;
  await prisma.$executeRaw`
    UPDATE "Recipe" SET status = 'PUBLISHED', "reviewRequired" = NULL, "publishedAt" = now()
    WHERE status = 'IN_REVIEW'`;
}
