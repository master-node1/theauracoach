import { subscribe } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';

/** Consent changes are kept for DPDP accountability (platform LLD §8). */
export const consentChanged = subscribe<'ConsentChanged@1', Prisma.TransactionClient>(
  'ConsentChanged@1',
  async (event, tx) => {
    const { userId, purpose, granted, policyVersion } = event.data;
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: 'user',
        action: granted ? 'consent.grant' : 'consent.withdraw',
        entityType: 'consent',
        entityId: userId,
        after: { purpose, granted, policyVersion },
        createdAt: new Date(event.occurredAt),
      },
    });
  },
);

/** Profile edits are audited by field name only: the values are health data and stay in profile-service. */
export const profileChanged = subscribe<'ProfileChanged@1', Prisma.TransactionClient>(
  'ProfileChanged@1',
  async (event, tx) => {
    const { userId, fields } = event.data;
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: 'user',
        action: 'profile.update',
        entityType: 'profile',
        entityId: userId,
        after: { fields },
        createdAt: new Date(event.occurredAt),
      },
    });
  },
);

export const subscriptions = [consentChanged, profileChanged];

/**
 * Data-subject requests (export, deletion, restore, purge) are audited by action only, from the
 * export and deletion events this service already takes part in (participantSubscriptions).
 */
export function dataRightsAudit(action: string) {
  return async (tx: Prisma.TransactionClient, userId: string, at: Date): Promise<void> => {
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: 'user',
        action,
        entityType: 'user',
        entityId: userId,
        createdAt: at,
      },
    });
  };
}
