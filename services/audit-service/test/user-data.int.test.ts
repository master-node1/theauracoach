import { resolve } from 'node:path';
import { describeParticipantContract } from '@aura/testing';
import * as vitest from 'vitest';
import { Prisma, PrismaClient } from '../src/generated/prisma';
import { userDataPlan } from '../src/user-data-plan';

async function seed(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      actorRole: 'user',
      action: 'consent.grant',
      entityType: 'consent',
      entityId: userId,
      after: { purpose: 'AI_COACH', granted: true },
      ipHash: 'a'.repeat(64),
    },
  });
}

describeParticipantContract(vitest, {
  service: 'audit-service',
  serviceDir: resolve(__dirname, '..'),
  plan: userDataPlan,
  models: Prisma.dmmf.datamodel.models,
  createClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  seed,
  afterPurge: async (prisma, userId) => {
    // The trail stays with the pseudonymous id only: no snapshots, no IP hash.
    const rows = await prisma.auditLog.findMany({ where: { actorId: userId } });
    vitest.expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) vitest.expect(row).toMatchObject({ before: null, after: null, ipHash: null });
  },
  redisDb: 12,
});
