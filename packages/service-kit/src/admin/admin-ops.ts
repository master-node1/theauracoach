import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import {
  deadLetterKey,
  dlqReplaySchema,
  opsServiceOf,
  ROLE_PERMISSIONS,
  type AdminField,
  type AdminUserSection,
  type DlqEntry,
  type DlqList,
  type DlqReplayInput,
  type DlqReplayResult,
  type GrantableRole,
  type OpsService,
  type Permission,
  type QueueHealth,
  type ServiceUsage,
  type UsageMetric,
} from '@aura/contracts';
import type { Redis } from 'ioredis';
import type { BaseConfig } from '../config/config';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators';
import { Permissions } from '../auth/permissions.guard';
import { EVENT_DATABASE } from '../events/event-worker';
import { writeOutbox } from '../events/outbox';
import type { SqlDatabase } from '../events/sql';
import { ProblemException } from '../http/problem';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { REDIS, SERVICE_KIT_CONFIG } from '../tokens';

/**
 * What a service adds to the admin console (admin LLD §4): its part of the masked support view
 * and its usage counters. Both are optional; a service without data for one leaves it out.
 */
export interface AdminReports {
  /** Title for this service's part of the support view, e.g. "Training". */
  readonly title?: string;
  /** Counts and dates about one user. Never free text the user wrote, never health notes. */
  userSummary?(userId: string): Promise<AdminField[]>;
  /** Counters for the usage dashboard, counting from `since` to now. */
  usage?(since: Date): Promise<UsageMetric[]>;
}

export const ADMIN_REPORTS = Symbol('ADMIN_REPORTS');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STREAM_ID = /^\d{1,20}-\d{1,20}$/;

/**
 * Moves one entry from the DLQ back to its stream, atomically: XDEL succeeds for exactly one
 * caller, so two replays of the same entry publish it once. Returns [stream, newId], or nil
 * when the entry is gone.
 */
const REPLAY_SCRIPT = `
local found = redis.call('XRANGE', KEYS[1], ARGV[1], ARGV[1])
if #found == 0 then return false end
local fields = found[1][2]
local stream, event
for i = 1, #fields, 2 do
  if fields[i] == 'stream' then stream = fields[i + 1] end
  if fields[i] == 'event' then event = fields[i + 1] end
end
if not stream or not event or event == '' then return redis.error_reply('NOT_REPLAYABLE') end
redis.call('XDEL', KEYS[1], ARGV[1])
local id = redis.call('XADD', stream, '*', 'event', event)
return {stream, id}
`;

type HttpReq = { id?: unknown };

/** The role the audit log shows for the actor: the first of theirs that carries `permission`. */
export function actorRoleFor(actor: AuthenticatedUser, permission: Permission): string {
  return (
    actor.groups.find((g) =>
      (ROLE_PERMISSIONS[g as GrantableRole] as readonly string[] | undefined)?.includes(permission),
    ) ?? 'staff'
  );
}

/** A request id fit for the audit log (a UUID), or null. */
export function auditRequestId(req: HttpReq): string | null {
  const id = req.id === undefined ? '' : String(req.id);
  return UUID.test(id) ? id : null;
}

function fieldsToRecord(fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < fields.length - 1; i += 2) out[fields[i]!] = fields[i + 1]!;
  return out;
}

/** Reads type, id and time from a dead-lettered envelope without trusting it to be valid JSON. */
function envelopeSummary(raw: string | undefined) {
  try {
    const parsed = JSON.parse(raw ?? '') as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : null);
    const version = typeof parsed.version === 'number' ? parsed.version : null;
    const type = str(parsed.type);
    return {
      eventType: type && version ? `${type}@${version}` : type,
      eventId: str(parsed.id),
      occurredAt: str(parsed.occurredAt),
    };
  } catch {
    return { eventType: null, eventId: null, occurredAt: null };
  }
}

/** Queue health, dead-letter replay and the service's admin reports, behind the admin routes. */
@Injectable()
export class AdminOps {
  readonly service: OpsService;

  constructor(
    @Inject(EVENT_DATABASE) private readonly db: SqlDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: BaseConfig,
    @Optional() @Inject(ADMIN_REPORTS) private readonly reports?: AdminReports,
  ) {
    this.service = opsServiceOf(config.SERVICE_NAME);
  }

  private get dlqKey(): string {
    return deadLetterKey(this.config.SERVICE_NAME);
  }

  async queues(): Promise<QueueHealth> {
    const [row] = await this.db.$queryRawUnsafe<{ pending: number; age: number | null }[]>(
      `SELECT count(*)::int AS "pending",
              EXTRACT(EPOCH FROM now() - min("createdAt"))::float8 AS "age"
       FROM "OutboxEvent" WHERE "publishedAt" IS NULL`,
    );
    return {
      service: this.service,
      outboxPending: row?.pending ?? 0,
      outboxOldestAgeSeconds: Math.round(row?.age ?? 0),
      dlqLength: await this.redis.xlen(this.dlqKey),
    };
  }

  async usage(days: number): Promise<ServiceUsage> {
    const since = new Date(Date.now() - days * 86_400_000);
    return { service: this.service, metrics: (await this.reports?.usage?.(since)) ?? [] };
  }

  async userSection(userId: string): Promise<AdminUserSection> {
    if (!this.reports?.userSummary) {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No support view here');
    }
    return {
      service: this.service,
      title: this.reports.title ?? this.service,
      fields: await this.reports.userSummary(userId),
    };
  }

  /** Newest first, at most 100; the payloads stay here. */
  async dlq(): Promise<DlqList> {
    const rows = (await this.redis.xrevrange(this.dlqKey, '+', '-', 'COUNT', 100)) as [
      string,
      string[],
    ][];
    const entries: DlqEntry[] = rows.map(([id, flat]) => {
      const f = fieldsToRecord(flat);
      return {
        id,
        stream: f.stream ?? '',
        entryId: f.entryId ?? '',
        reason: f.reason ?? '',
        ...envelopeSummary(f.event),
      };
    });
    return { service: this.service, total: await this.redis.xlen(this.dlqKey), entries };
  }

  /**
   * Re-publishes a dead-lettered event to its stream once and audits it. The audit row and the
   * replay share a transaction: a replay that finds nothing rolls the audit back. Consumers that
   * already handled the event skip it (ProcessedEvent), so only the failed one does the work.
   */
  async replay(
    actor: AuthenticatedUser,
    id: string,
    input: DlqReplayInput,
    requestId: string | null,
  ): Promise<DlqReplayResult> {
    if (!STREAM_ID.test(id)) {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'DLQ_ENTRY_NOT_FOUND', 'No such entry');
    }
    const [entry] = (await this.redis.xrange(this.dlqKey, id, id)) as [string, string[]][];
    if (!entry) {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'DLQ_ENTRY_NOT_FOUND', 'No such entry');
    }
    const summary = envelopeSummary(fieldsToRecord(entry[1]).event);
    return this.db.$transaction(async (tx) => {
      await writeOutbox(tx, {
        producer: this.config.SERVICE_NAME,
        key: 'AuditEvent@1',
        userId: null,
        data: {
          actorId: actor.userId,
          actorRole: actorRoleFor(actor, 'event:replay'),
          action: 'event.replay',
          entityType: 'dead_letter',
          entityId: `${this.service}:${id}`,
          before: { eventType: summary.eventType, eventId: summary.eventId },
          after: null,
          requestId,
          reason: input.reason,
        },
      });
      let result: [string, string] | null;
      try {
        result = (await this.redis.eval(REPLAY_SCRIPT, 1, this.dlqKey, id)) as
          [string, string] | null;
      } catch (err) {
        if (err instanceof Error && err.message.includes('NOT_REPLAYABLE')) {
          throw new ProblemException(
            HttpStatus.CONFLICT,
            'DLQ_ENTRY_NOT_REPLAYABLE',
            'This entry has no event to replay',
          );
        }
        throw err;
      }
      if (!result) {
        throw new ProblemException(
          HttpStatus.NOT_FOUND,
          'DLQ_ENTRY_NOT_FOUND',
          'No such entry; it may have been replayed already',
        );
      }
      return { id, stream: result[0], newEntryId: result[1] };
    });
  }

  /** The `:service` path segment must name this service; another service's path is not ours. */
  check(service: string): void {
    if (service !== this.service) {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    }
  }
}

/**
 * Every service's operations routes, `/v1/admin/ops/{service}/…` (gateway routes each prefix to its
 * service). Admin routes: MFA and the listed permission are enforced by the global guards.
 */
@Controller('v1/admin/ops/:service')
export class AdminOpsController {
  constructor(private readonly ops: AdminOps) {}

  @Get('queues')
  @Permissions('usage:read')
  queues(@Param('service') service: string): Promise<QueueHealth> {
    this.ops.check(service);
    return this.ops.queues();
  }

  @Get('usage')
  @Permissions('usage:read')
  usage(@Param('service') service: string): Promise<ServiceUsage> {
    this.ops.check(service);
    return this.ops.usage(7);
  }

  @Get('users/:userId')
  @Permissions('user:support_read')
  user(
    @Param('service') service: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<AdminUserSection> {
    this.ops.check(service);
    return this.ops.userSection(userId.toLowerCase());
  }

  @Get('dlq')
  @Permissions('event:replay')
  dlq(@Param('service') service: string): Promise<DlqList> {
    this.ops.check(service);
    return this.ops.dlq();
  }

  @Post('dlq/:id/replay')
  @HttpCode(HttpStatus.OK)
  @Permissions('event:replay')
  replay(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('service') service: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(dlqReplaySchema)) body: DlqReplayInput,
    @Req() req: HttpReq,
  ): Promise<DlqReplayResult> {
    this.ops.check(service);
    return this.ops.replay(actor, id, body, auditRequestId(req));
  }
}
