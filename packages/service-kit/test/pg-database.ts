import { Pool, type PoolClient } from 'pg';
import type { SqlDatabase, SqlExecutor } from '../src';

/** Minimal SqlDatabase over node-postgres, standing in for a service's Prisma client in tests. */
export function pgDatabase(pool: Pool): SqlDatabase {
  const exec = (client: Pool | PoolClient): SqlExecutor => ({
    async $executeRawUnsafe(query, ...values) {
      return (await client.query(query, values)).rowCount ?? 0;
    },
    async $queryRawUnsafe<T>(query: string, ...values: unknown[]) {
      return (await client.query(query, values)).rows as T;
    },
  });
  return {
    ...exec(pool),
    async $transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(exec(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/** Same columns as every service schema's OutboxEvent and ProcessedEvent models. */
export const EVENT_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS "OutboxEvent" (
  "id" uuid PRIMARY KEY,
  "type" varchar(60) NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "userId" uuid,
  "payload" jsonb NOT NULL,
  "traceparent" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" timestamp(3),
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text
);
CREATE TABLE IF NOT EXISTS "ProcessedEvent" (
  "eventId" text PRIMARY KEY,
  "type" varchar(60) NOT NULL,
  "processedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Seen" ("userId" uuid PRIMARY KEY, "timezone" text NOT NULL);
`;
