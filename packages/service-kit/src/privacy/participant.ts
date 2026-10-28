import type { DataParticipant } from '@aura/contracts';
import type { SqlExecutor } from '../events/sql';
import { writeOutbox } from '../events/outbox';
import { subscribe, type Subscription } from '../events/stream-consumer';
import { accountStateSubscriptions } from './account-state';
import type { ObjectStorage } from './object-storage';
import { exportJson, exportUserData, purgeUserData, type UserDataPlan } from './user-data';

export interface ParticipantOptions<Tx extends SqlExecutor> {
  service: DataParticipant;
  plan: UserDataPlan;
  storage: ObjectStorage;
  logger?: { log(obj: object): void };
  /** Extra work in the same transaction as each step, e.g. audit entries or pausing sends. */
  onExported?: (tx: Tx, userId: string, at: Date) => Promise<void>;
  onPurged?: (tx: Tx, userId: string, at: Date) => Promise<void>;
  onPending?: (tx: Tx, userId: string, at: Date) => Promise<void>;
  onRestored?: (tx: Tx, userId: string, at: Date) => Promise<void>;
}

/**
 * Everything a service needs to take part in export and deletion (service catalog §6.3):
 *  - ExportRequested: write this service's rows to `{exportPrefix}{service}.json`, then ExportPartReady.
 *  - AccountDeleted: delete the user's rows per the plan, then UserDataPurged.
 *  - AccountDeletionRequested / AccountRestored: keep the `AccountState` replica for the 423 check.
 * Handlers run in the consumer's transaction, so a redelivered event is a no-op (ProcessedEvent),
 * and a failure rolls back the outbox write too.
 */
export function participantSubscriptions<Tx extends SqlExecutor = SqlExecutor>(
  options: ParticipantOptions<Tx>,
): Subscription[] {
  const { service, plan, storage } = options;
  if (plan.service !== service) throw new Error(`Plan for ${plan.service} used by ${service}`);
  return [
    subscribe<'ExportRequested@1', Tx>('ExportRequested@1', async (event, tx) => {
      const { requestId, userId, exportPrefix } = event.data;
      const data = await exportUserData(tx, plan, userId);
      const key = `${exportPrefix}${service}.json`;
      // Written before the outbox row commits; a retry simply overwrites the same object.
      await storage.put(key, exportJson(data), 'application/json');
      const rows = Object.values(data.tables).reduce((n, t) => n + t.length, 0);
      await writeOutbox(tx, {
        producer: service,
        key: 'ExportPartReady@1',
        userId,
        data: { requestId, userId, service, key, rows },
      });
      await options.onExported?.(tx, userId, new Date(event.occurredAt));
    }),
    subscribe<'AccountDeleted@1', Tx>('AccountDeleted@1', async (event, tx) => {
      const { userId, requestId } = event.data;
      const counts = await purgeUserData(tx, plan, userId);
      // Counts only: no ids or values of what was deleted.
      options.logger?.log({ msg: 'User data purged', requestId, counts });
      await options.onPurged?.(tx, userId, new Date(event.occurredAt));
      await writeOutbox(tx, {
        producer: service,
        key: 'UserDataPurged@1',
        userId,
        data: { userId, requestId, service },
      });
    }),
    ...accountStateSubscriptions<Tx>({
      ...(options.onPending ? { onPending: options.onPending } : {}),
      ...(options.onRestored ? { onRestored: options.onRestored } : {}),
    }),
  ] as Subscription[];
}
