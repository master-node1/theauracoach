import { z } from 'zod';
import type { ServiceName } from '../services';

/**
 * Admin console APIs (admin LLD §4–6). Each service owns its admin endpoints; the web BFF
 * assembles the support view and dashboards from them.
 */

/** A staff member's reason for a sensitive action; stored in the audit log. */
export const auditReasonSchema = z.string().trim().min(3).max(200);

/** Body of POST …/dlq/{id}/replay. */
export const dlqReplaySchema = z.strictObject({ reason: auditReasonSchema });
export type DlqReplayInput = z.infer<typeof dlqReplaySchema>;

/**
 * Short service names used in `/v1/admin/ops/{service}/…`. The gateway routes each to its
 * service, so per-service operations (queues, DLQ, support summaries, usage) share one shape.
 */
export const OPS_SERVICES = [
  'profile',
  'workout',
  'nutrition',
  'progress',
  'coach',
  'notification',
  'audit',
] as const;
export type OpsService = (typeof OPS_SERVICES)[number];

export function opsServiceOf(service: ServiceName): OpsService {
  return service.replace(/-service$/, '') as OpsService;
}

/** Path prefix of a service's operations endpoints, e.g. `/v1/admin/ops/workout`. */
export function adminOpsPath(service: OpsService): string {
  return `/v1/admin/ops/${service}`;
}

/** One value in the support view or a usage report. Never free text the user wrote. */
export interface AdminField {
  label: string;
  value: string | number | boolean | null;
}

/** GET /v1/admin/ops/{service}/users/{id}: what one service holds about a user, masked. */
export interface AdminUserSection {
  service: OpsService;
  title: string;
  fields: AdminField[];
}

/** GET /v1/admin/users?email=: who an email belongs to, without revealing the full address. */
export interface AdminUserLookup {
  userId: string;
  emailMasked: string;
  status: string;
  createdAt: string;
}

/** GET /v1/admin/users/{id} (profile-service): the account part of the support view. */
export interface AdminUserAccount extends AdminUserSection {
  userId: string;
  emailMasked: string;
}

/** A usage counter, e.g. sign-ups in the last 7 days. */
export interface UsageMetric {
  key: string;
  label: string;
  value: number;
}

/** GET /v1/admin/ops/{service}/usage */
export interface ServiceUsage {
  service: OpsService;
  metrics: UsageMetric[];
}

/** GET /v1/admin/ops/{service}/queues: outbox and dead-letter health (TAC-5 metrics, on demand). */
export interface QueueHealth {
  service: OpsService;
  outboxPending: number;
  outboxOldestAgeSeconds: number;
  dlqLength: number;
}

/** One dead-lettered event. The payload stays on the server: it can hold user data. */
export interface DlqEntry {
  id: string;
  stream: string;
  entryId: string;
  reason: string;
  eventType: string | null;
  eventId: string | null;
  occurredAt: string | null;
}

/** GET /v1/admin/ops/{service}/dlq */
export interface DlqList {
  service: OpsService;
  total: number;
  entries: DlqEntry[];
}

/** POST /v1/admin/ops/{service}/dlq/{id}/replay */
export interface DlqReplayResult {
  id: string;
  stream: string;
  newEntryId: string;
}

/** Query of GET /v1/admin/audit and /v1/admin/audit/export.csv. */
export const auditQuerySchema = z.strictObject({
  entityType: z.string().trim().min(1).max(40).optional(),
  entityId: z.string().trim().min(1).max(100).optional(),
  actorId: z.uuid().optional(),
  action: z
    .string()
    .trim()
    .regex(/^[a-z_]+(\.[a-z_]+)?$/)
    .optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  order: z.enum(['desc', 'asc']).default('desc'),
  cursor: z
    .string()
    .regex(/^\d{1,19}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
}

/** GET /v1/admin/audit: newest first unless `order=asc`; pass `nextCursor` back as `cursor`. */
export interface AuditPage {
  entries: AuditEntry[];
  nextCursor: string | null;
}

/** Keys removed from audit before/after when shown or exported (admin LLD §5). */
export const AUDIT_SENSITIVE_KEYS = [
  'email',
  'displayName',
  'name',
  'phone',
  'dateOfBirth',
  'notes',
  'healthNotes',
  'conditions',
  'token',
  'password',
] as const;

/** Copies `value` with sensitive keys (at any depth) replaced by "[removed]". */
export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = (AUDIT_SENSITIVE_KEYS as readonly string[]).includes(k)
      ? '[removed]'
      : redactAuditValue(v);
  }
  return out;
}

/** `priya.sharma@example.com` → `pr***@e***.com`: enough to confirm a caller, not to contact them. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local.slice(0, Math.min(2, local.length - 1) || 1)}***@${host.slice(0, 1)}***${tld}`;
}
