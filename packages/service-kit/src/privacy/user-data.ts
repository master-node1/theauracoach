import type { ServiceName } from '@aura/contracts';
import type { SqlExecutor } from '../events/sql';

/**
 * Which of a service's tables hold a user's data, and what export and deletion do with them
 * (users LLD §3–4, TC-PRV-1/2). Every Prisma model must be listed either in `tables` or in
 * `notUserData`, which `planProblems` checks against the generated client in each service's tests,
 * so a new table cannot be forgotten.
 */
export interface UserTable {
  /** Prisma model name, e.g. `WorkoutSession`. */
  model: string;
  /**
   * Prisma `where` for this user's rows, e.g. `{ userId }` or `{ session: { userId } }`. May look
   * up ids first through `tx` when the rows are linked without a relation.
   */
  where(userId: string, tx: never): Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Left out of the export, with the reason. Omit to export the rows. */
  notExported?: string;
  /**
   * What deletion does: delete the rows (default), overwrite fields to anonymise them, or keep
   * them with the reason (only for records that carry no personal data beyond the id).
   */
  purge?: 'delete' | { anonymise: Record<string, unknown> } | { keep: string };
}

export interface UserDataPlan {
  service: ServiceName;
  /** In deletion order: children before the parents they reference. */
  tables: UserTable[];
  /** Models without personal data (catalogues, configuration), with the reason. */
  notUserData: Record<string, string>;
}

/** Tables service-kit itself manages in every service, handled by exportUserData and purgeUserData. */
export const PLATFORM_TABLES: Record<string, string> = {
  OutboxEvent: 'Event transport; published rows for the user are deleted, never exported',
  ProcessedEvent: 'Event ids only',
  AccountState: 'Pending-deletion replica; deleted with the user',
};

/**
 * Field names that mark a model as holding a user's data. (`createdById`/`updatedById` on content
 * and policy tables name staff authors, so they are not counted.)
 */
const PERSONAL_KEYS = ['userId', 'actorId'];

interface ModelInfo {
  name: string;
  fields: readonly { name: string }[];
}

/**
 * What is wrong with a plan, given the service's models (`Prisma.dmmf.datamodel.models`): models
 * nobody classified, classified models that do not exist, and models with a user column declared
 * as not user data. Empty means the plan covers the schema.
 */
export function planProblems(plan: UserDataPlan, models: readonly ModelInfo[]): string[] {
  const problems: string[] = [];
  const names = new Set(models.map((m) => m.name));
  const listed = new Map<string, string>();
  const note = (model: string, where: string) => {
    const before = listed.get(model);
    if (before) problems.push(`${model} is listed twice (${before} and ${where})`);
    listed.set(model, where);
  };
  for (const t of plan.tables) note(t.model, 'tables');
  for (const m of Object.keys(plan.notUserData)) note(m, 'notUserData');
  for (const m of Object.keys(PLATFORM_TABLES)) if (names.has(m)) note(m, 'platform');

  for (const model of models) {
    const where = listed.get(model.name);
    if (!where) {
      problems.push(`${model.name} is not in the user data plan`);
      continue;
    }
    const personal = model.fields.find((f) => PERSONAL_KEYS.includes(f.name));
    if (where === 'notUserData' && personal) {
      problems.push(`${model.name} has ${personal.name} but is listed as not user data`);
    }
  }
  for (const [model] of listed) {
    if (!names.has(model)) problems.push(`${model} is in the plan but not in the schema`);
  }
  return problems;
}

interface Delegate {
  findMany(args: { where: Record<string, unknown> }): Promise<unknown[]>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
}

function delegate(tx: unknown, model: string): Delegate {
  const d = (tx as Record<string, Delegate | undefined>)[model[0]!.toLowerCase() + model.slice(1)];
  if (!d) throw new Error(`No Prisma delegate for ${model}`);
  return d;
}

export interface UserDataExport {
  service: ServiceName;
  userId: string;
  generatedAt: string;
  /** Rows per model, as stored (dates as ISO strings, decimals and big integers as strings). */
  tables: Record<string, unknown[]>;
}

/** Reads every exported table for the user. `tx` is the service's Prisma client or transaction. */
export async function exportUserData(
  tx: unknown,
  plan: UserDataPlan,
  userId: string,
  now = new Date(),
): Promise<UserDataExport> {
  const tables: Record<string, unknown[]> = {};
  for (const table of plan.tables) {
    if (table.notExported) continue;
    const where = await table.where(userId, tx as never);
    tables[table.model] = await delegate(tx, table.model).findMany({ where });
  }
  return { service: plan.service, userId, generatedAt: now.toISOString(), tables };
}

/** JSON for exports: big integers (BigInt ids, costs) become strings instead of throwing. */
export function exportJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

/**
 * Deletes (or anonymises) the user's rows in plan order, then the platform tables: published
 * outbox rows about the user and the account-state replica. Returns affected rows per model.
 */
export async function purgeUserData(
  tx: SqlExecutor,
  plan: UserDataPlan,
  userId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of plan.tables) {
    const purge = table.purge ?? 'delete';
    if (typeof purge === 'object' && 'keep' in purge) continue;
    const d = delegate(tx, table.model);
    const where = await table.where(userId, tx as never);
    counts[table.model] =
      purge === 'delete'
        ? (await d.deleteMany({ where })).count
        : (await d.updateMany({ where, data: purge.anonymise })).count;
  }
  // Unpublished rows stay: they are still to be delivered, and the purge event itself is one.
  counts.OutboxEvent = await tx.$executeRawUnsafe(
    `DELETE FROM "OutboxEvent" WHERE "userId" = $1::uuid AND "publishedAt" IS NOT NULL`,
    userId,
  );
  if (plan.service !== 'profile-service') {
    counts.AccountState = await tx.$executeRawUnsafe(
      `DELETE FROM "AccountState" WHERE "userId" = $1::uuid`,
      userId,
    );
  }
  return counts;
}

/** Rows still left for the user in each table that deletion should have emptied (tests, checks). */
export async function remainingUserRows(
  tx: unknown,
  plan: UserDataPlan,
  userId: string,
): Promise<Record<string, number>> {
  const left: Record<string, number> = {};
  for (const table of plan.tables) {
    if ((table.purge ?? 'delete') !== 'delete') continue;
    const where = await table.where(userId, tx as never);
    const rows = await delegate(tx, table.model).findMany({ where });
    if (rows.length > 0) left[table.model] = rows.length;
  }
  return left;
}
