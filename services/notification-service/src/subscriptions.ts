import type { Prisma } from './generated/prisma';
import { consentChanged, profileChanged } from './consents/user-updates.subscription';
import { userRegistered } from './preferences/user-registered.subscription';

/** Every event this service consumes, besides export and deletion (worker.module.ts). */
export const subscriptions = [userRegistered, consentChanged, profileChanged];

/** A pending deletion stops every send at once (service catalog §6.3); a restore resumes them. */
export async function pauseSends(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.notificationPreference.upsert({
    where: { userId },
    create: { userId, paused: true, mealReminderSlots: [] },
    update: { paused: true },
  });
  await tx.notification.updateMany({
    where: { userId, status: 'SCHEDULED' },
    data: { status: 'CANCELLED' },
  });
}

export async function resumeSends(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.notificationPreference.updateMany({ where: { userId }, data: { paused: false } });
}
