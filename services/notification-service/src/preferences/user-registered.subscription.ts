import { subscribe } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';

/** A new user gets default reminder settings in their timezone (notifications LLD §1). */
export const userRegistered = subscribe<'UserRegistered@1', Prisma.TransactionClient>(
  'UserRegistered@1',
  async (event, tx) => {
    const { userId, timezone, locale } = event.data;
    await tx.notificationPreference.upsert({
      where: { userId },
      create: { userId, timezone, locale, mealReminderSlots: [] },
      update: { timezone, locale },
    });
  },
);

export const subscriptions = [userRegistered];
