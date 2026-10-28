import { HttpStatus, Injectable } from '@nestjs/common';
import {
  redactAuditValue,
  type AuditEntry,
  type AuditPage,
  type AuditQuery,
} from '@aura/contracts';
import { actorRoleFor, ProblemException, type AuthenticatedUser } from '@aura/service-kit';
import type { AuditLog, Prisma } from '../generated/prisma';
import { PrismaService } from '../prisma.service';

/** Rows in one CSV export. Wider ranges are exported in parts by narrowing the time filter. */
export const EXPORT_LIMIT = 10_000;

const CSV_COLUMNS = [
  'id',
  'createdAt',
  'actorId',
  'actorRole',
  'action',
  'entityType',
  'entityId',
  'reason',
  'requestId',
  'before',
  'after',
] as const;

type Json = Record<string, unknown> | null;

export function toEntry(row: AuditLog): AuditEntry {
  return {
    id: row.id.toString(),
    actorId: row.actorId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: redactAuditValue(row.before) as Json,
    after: redactAuditValue(row.after) as Json,
    reason: row.reason,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One CSV cell (RFC 4180), with spreadsheet formula injection neutralised. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Reads the append-only audit log for the admin console (admin LLD §5). Entries are shown with
 * sensitive fields removed; nothing here changes or deletes an entry.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  private where(q: AuditQuery): Prisma.AuditLogWhereInput {
    if (q.from && q.to && new Date(q.from) > new Date(q.to)) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_FAILED',
        '`from` must be before `to`',
      );
    }
    return {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId.toLowerCase() } : {}),
      // `role` matches every role.* action; `role.grant` only that one.
      ...(q.action
        ? q.action.includes('.')
          ? { action: q.action }
          : { action: { startsWith: `${q.action}.` } }
        : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
  }

  /** Cursor pagination on the id, which grows with insertion order. */
  async list(q: AuditQuery): Promise<AuditPage> {
    const cursor = q.cursor ? BigInt(q.cursor) : undefined;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...this.where(q),
        ...(cursor !== undefined
          ? { id: q.order === 'desc' ? { lt: cursor } : { gt: cursor } }
          : {}),
      },
      orderBy: { id: q.order },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      entries: page.map(toEntry),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id.toString() : null,
    };
  }

  async get(id: string): Promise<AuditEntry> {
    const row = /^\d{1,19}$/.test(id)
      ? await this.prisma.auditLog.findUnique({ where: { id: BigInt(id) } })
      : null;
    if (!row) throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No such entry');
    return toEntry(row);
  }

  /** The matching entries as CSV, oldest first; the export itself is recorded in the log. */
  async exportCsv(
    actor: AuthenticatedUser,
    q: AuditQuery,
    requestId: string | null,
  ): Promise<string> {
    const rows = await this.prisma.auditLog.findMany({
      where: this.where(q),
      orderBy: { id: 'asc' },
      take: EXPORT_LIMIT,
    });
    const filters = Object.fromEntries(
      Object.entries(q).filter(
        ([k, v]) => v !== undefined && !['order', 'cursor', 'limit'].includes(k),
      ),
    );
    await this.prisma.auditLog.create({
      data: {
        actorId: actor.userId,
        actorRole: actorRoleFor(actor, 'audit:read'),
        action: 'audit.export',
        entityType: 'audit_log',
        entityId: 'export',
        after: { filters, rows: rows.length },
        requestId,
      },
    });
    const lines = [CSV_COLUMNS.join(',')];
    for (const row of rows) {
      const entry = toEntry(row);
      lines.push(CSV_COLUMNS.map((c) => csvCell(entry[c])).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
  }
}
