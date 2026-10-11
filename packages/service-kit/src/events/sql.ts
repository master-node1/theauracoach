/**
 * The slice of a Prisma client the event machinery needs. Each service passes its own client,
 * so service-kit never depends on any service's generated Prisma types.
 * Every service schema has the same `OutboxEvent` and `ProcessedEvent` tables.
 */
export interface SqlExecutor {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

export interface SqlDatabase extends SqlExecutor {
  $transaction<R>(fn: (tx: SqlExecutor) => Promise<R>): Promise<R>;
}
