import { Injectable } from '@nestjs/common';
import type { ConsentPurpose } from '@aura/contracts';
import { subscribe, type ConsentStateReader } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma.service';

/**
 * Keeps the local AI_COACH consent replica (auth LLD §1). Users the replica has never heard of
 * count as not consented, so the coach stays closed until ConsentChanged arrives.
 */
export const consentChanged = subscribe<'ConsentChanged@1', Prisma.TransactionClient>(
  'ConsentChanged@1',
  async (event, tx) => {
    const { userId, purpose, granted } = event.data;
    if (purpose !== 'AI_COACH') return;
    // Worker replicas may handle a user's events out of order; only a newer event wins.
    const changedAt = new Date(event.occurredAt);
    const updated = await tx.userConsentState.updateMany({
      where: { userId, changedAt: { lt: changedAt } },
      data: { aiCoach: granted, changedAt },
    });
    if (updated.count === 0) {
      await tx.userConsentState.createMany({
        data: [{ userId, aiCoach: granted, changedAt }],
        skipDuplicates: true,
      });
    }
  },
);

/** Backs ConsentGuard from the replica. coach-service only holds AI_COACH. */
@Injectable()
export class ConsentStateService implements ConsentStateReader {
  constructor(private readonly prisma: PrismaService) {}

  async isGranted(userId: string, purpose: ConsentPurpose): Promise<boolean> {
    if (purpose !== 'AI_COACH') return false;
    const row = await this.prisma.userConsentState.findUnique({
      where: { userId },
      select: { aiCoach: true },
    });
    return row?.aiCoach ?? false;
  }
}
