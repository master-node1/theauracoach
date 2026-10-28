import { subscribe, type Subscription } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';
import type { DeletionService } from './deletion.service';
import type { ExportsService } from './exports.service';

/** profile-service tracks every participant's part of an export or deletion (catalog §6.3). */
export function privacySubscriptions(
  exports: ExportsService,
  deletion: DeletionService,
): Subscription[] {
  return [
    subscribe<'ExportPartReady@1', Prisma.TransactionClient>('ExportPartReady@1', (event, tx) =>
      exports.partReady(tx, event.data),
    ),
    subscribe<'UserDataPurged@1', Prisma.TransactionClient>('UserDataPurged@1', (event, tx) =>
      deletion.purgeConfirmed(tx, event.data),
    ),
  ] as Subscription[];
}
