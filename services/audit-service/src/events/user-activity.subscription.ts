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

/** Admin actions from every service (admin LLD §5), stored as sent: producers already redact them. */
export const auditEvent = subscribe<'AuditEvent@1', Prisma.TransactionClient>(
  'AuditEvent@1',
  async (event, tx) => {
    const { actorId, actorRole, action, entityType, entityId, before, after, requestId } =
      event.data;
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole,
        action,
        entityType,
        entityId,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
        requestId,
        createdAt: new Date(event.occurredAt),
      },
    });
  },
);

export const subscriptions = [consentChanged, profileChanged, auditEvent];
