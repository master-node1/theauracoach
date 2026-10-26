import { subscribe } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';

/**
 * Keeps the local copy of notification consent (notifications LLD §1). Streams are not ordered with
 * each other, so the row is created here if UserRegistered has not been handled yet.
 */
export const consentChanged = subscribe<'ConsentChanged@1', Prisma.TransactionClient>(
  'ConsentChanged@1',
  async (event, tx) => {
    const { userId, purpose, granted } = event.data;
    if (purpose !== 'NOTIFICATIONS') return;
    await tx.notificationPreference.upsert({
      where: { userId },
      create: { userId, consented: granted, mealReminderSlots: [] },
      update: { consented: granted },
    });
  },
);

/** Reminders are scheduled in the user's time zone, so follow changes to it. */
export const profileChanged = subscribe<'ProfileChanged@1', Prisma.TransactionClient>(
  'ProfileChanged@1',
  async (event, tx) => {
    const { userId, changes } = event.data;
    const data = {
      ...(changes.timezone ? { timezone: changes.timezone } : {}),
      ...(changes.locale ? { locale: changes.locale } : {}),
    };
    if (Object.keys(data).length === 0) return;
    await tx.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data, mealReminderSlots: [] },
      update: data,
    });
  },
);
