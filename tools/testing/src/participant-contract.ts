import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamKey, type DataParticipant } from '@aura/contracts';
import {
  LocalObjectStorage,
  StreamConsumer,
  isPendingDeletion,
  participantSubscriptions,
  planProblems,
  remainingUserRows,
  type SqlDatabase,
  type UserDataExport,
  type UserDataPlan,
} from '@aura/service-kit';
import { Redis } from 'ioredis';
import { createTestDatabase, requireEnv, type TestDatabase } from './index';

type Client = SqlDatabase & { $disconnect(): Promise<void> };

/**
 * The vitest functions the suite uses. Passed in (`import * as vitest from 'vitest'`) because this
 * package is CommonJS and vitest can only be imported, not required.
 */
export type Vitest = typeof import('vitest');

export interface ParticipantContractOptions<C extends Client> {
  service: DataParticipant;
  /** The service package directory, for its migrations. */
  serviceDir: string;
  plan: UserDataPlan;
  /** `Prisma.dmmf.datamodel.models` from the service's generated client. */
  models: readonly { name: string; fields: readonly { name: string }[] }[];
  createClient(url: string): C;
  /** Writes at least one row for `userId` in every table of the plan. */
  seed(client: C, userId: string): Promise<void>;
  /** Checks for tables the plan anonymises or keeps instead of deleting. */
  afterPurge?(client: C, userId: string): Promise<void>;
  /** Redis database for this suite (1–14), so suites running in parallel stay apart. */
  redisDb: number;
}

/**
 * The export and deletion contract every participant service must meet (TC-PRV-1/2, users LLD
 * §6): the plan covers the schema, the export holds every exported table and only this user's
 * rows, deletion empties every table, the pending-deletion replica follows the newest event, and
 * redelivered events change nothing.
 */
export function describeParticipantContract<C extends Client>(
  vitest: Pick<Vitest, 'afterAll' | 'beforeAll' | 'describe' | 'expect' | 'it'>,
  options: ParticipantContractOptions<C>,
): void {
  const { afterAll, beforeAll, describe, expect, it } = vitest;
  const { service, plan } = options;
  let db: TestDatabase;
  let client: C;
  let redis: Redis;
  let storageDir: string;
  let storage: LocalObjectStorage;
  let consumer: StreamConsumer;

  async function publish(type: string, userId: string, data: object, occurredAt = new Date()) {
    const id = randomUUID();
    const event = {
      id,
      type,
      version: 1,
      occurredAt: occurredAt.toISOString(),
      producer: 'profile-service',
      userId,
      traceparent: null,
      data,
    };
    await redis.xadd(streamKey(type, 1), '*', 'event', JSON.stringify(event));
    return { id, raw: JSON.stringify(event) };
  }

  async function outbox(type: string, userId: string) {
    return client.$queryRawUnsafe<{ payload: { data: Record<string, unknown> } }[]>(
      `SELECT "payload" FROM "OutboxEvent" WHERE "type" = $1 AND "userId" = $2::uuid`,
      type,
      userId,
    );
  }

  describe(`${service} export and deletion contract`, () => {
    beforeAll(async () => {
      db = await createTestDatabase(options.serviceDir, `${service.split('-')[0]}_privacy`);
      client = options.createClient(db.url);
      redis = new Redis(requireEnv('TEST_REDIS_URL'), { db: options.redisDb });
      await redis.flushdb();
      storageDir = await mkdtemp(join(tmpdir(), `aura-${service}-`));
      storage = new LocalObjectStorage(storageDir, 'http://localhost/files', 'k'.repeat(32));
      consumer = new StreamConsumer(client, redis, {
        group: service,
        consumerName: 'test',
        subscriptions: participantSubscriptions({ service, plan, storage }),
      });
      await consumer.ensureGroups();
    });

    afterAll(async () => {
      await client?.$disconnect();
      redis?.disconnect();
      await db?.drop();
      if (storageDir) await rm(storageDir, { recursive: true, force: true });
    });

    it('classifies every table in the schema', () => {
      expect(planProblems(plan, options.models)).toEqual([]);
    });

    it('seeds every table the plan covers (so the checks below see real rows)', async () => {
      const userId = randomUUID();
      await options.seed(client, userId);
      const missing: string[] = [];
      for (const table of plan.tables) {
        const where = await table.where(userId, client as never);
        const rows = await (
          client as unknown as Record<string, { count(a: object): Promise<number> }>
        )[table.model[0]!.toLowerCase() + table.model.slice(1)]!.count({ where });
        if (rows === 0) missing.push(table.model);
      }
      expect(missing).toEqual([]);
    });

    it('exports every exported table with only this user’s rows (TC-PRV-1)', async () => {
      const userId = randomUUID();
      const other = randomUUID();
      await options.seed(client, userId);
      await options.seed(client, other);
      const requestId = randomUUID();
      const exportPrefix = `user-private/${userId}/exports/${requestId}/`;
      await publish('ExportRequested', userId, { requestId, userId, exportPrefix });
      expect(await consumer.pollOnce(100)).toEqual(['processed']);

      const part = JSON.parse(
        (await storage.get(`${exportPrefix}${service}.json`)).toString(),
      ) as UserDataExport;
      expect(part).toMatchObject({ service, userId });
      const exported = plan.tables.filter((t) => !t.notExported).map((t) => t.model);
      expect(Object.keys(part.tables).sort()).toEqual([...exported].sort());
      for (const model of exported) expect(part.tables[model]?.length, model).toBeGreaterThan(0);
      expect(JSON.stringify(part)).not.toContain(other);

      const [ready] = await outbox('ExportPartReady', userId);
      expect(ready?.payload.data).toMatchObject({
        requestId,
        service,
        key: `${exportPrefix}${service}.json`,
      });
    });

    it('keeps the pending-deletion state from the newest event', async () => {
      const userId = randomUUID();
      const t0 = new Date('2026-10-27T10:00:00Z');
      const due = { userId, deletionDueAt: '2026-11-26T10:00:00.000Z' };
      await publish('AccountDeletionRequested', userId, due, t0);
      await consumer.pollOnce(100);
      expect(await isPendingDeletion(client, userId)).toBe(true);

      await publish('AccountRestored', userId, { userId }, new Date(t0.getTime() + 60_000));
      // A redelivered, older request must not undo the restore.
      await publish('AccountDeletionRequested', userId, due, t0);
      await consumer.pollOnce(100);
      expect(await isPendingDeletion(client, userId)).toBe(false);
    });

    it('deletes every row of the user and nobody else’s, once (TC-PRV-2)', async () => {
      const userId = randomUUID();
      const other = randomUUID();
      await options.seed(client, userId);
      await options.seed(client, other);
      await publish('AccountDeletionRequested', userId, {
        userId,
        deletionDueAt: new Date().toISOString(),
      });
      await consumer.pollOnce(100);
      const before = await remainingUserRows(client, plan, other);

      const requestId = randomUUID();
      const { raw } = await publish('AccountDeleted', userId, { userId, requestId });
      expect(await consumer.pollOnce(100)).toEqual(['processed']);

      expect(await remainingUserRows(client, plan, userId)).toEqual({});
      expect(await remainingUserRows(client, plan, other)).toEqual(before);
      const state = await client.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM "AccountState" WHERE "userId" = $1::uuid`,
        userId,
      );
      expect(state).toEqual([]);
      await options.afterPurge?.(client, userId);
      const purged = await outbox('UserDataPurged', userId);
      expect(purged.map((p) => p.payload.data)).toEqual([{ userId, requestId, service }]);

      // The same event delivered again (same id) is recorded as a duplicate and changes nothing.
      await redis.xadd(streamKey('AccountDeleted', 1), '*', 'event', raw);
      expect(await consumer.pollOnce(100)).toEqual(['duplicate']);
      expect(await outbox('UserDataPurged', userId)).toHaveLength(1);
    });
  });
}
