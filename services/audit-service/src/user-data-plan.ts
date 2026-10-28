import type { UserDataPlan } from '@aura/service-kit';
import { Prisma } from './generated/prisma';

/**
 * audit-service's part of export and deletion. Audit rows are kept as the record of what happened,
 * but only with the pseudonymous user id: the before/after snapshots and IP hash go (acceptance
 * criteria "Deleted accounts are purged after the grace period").
 */
export const userDataPlan: UserDataPlan = {
  service: 'audit-service',
  tables: [
    {
      model: 'AuditLog',
      where: (userId) => ({ OR: [{ actorId: userId }, { entityType: 'user', entityId: userId }] }),
      purge: { anonymise: { before: Prisma.DbNull, after: Prisma.DbNull, ipHash: null } },
    },
  ],
  notUserData: {},
};
