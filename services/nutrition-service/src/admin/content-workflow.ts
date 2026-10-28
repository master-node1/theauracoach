import { HttpStatus } from '@nestjs/common';
import {
  contentTransition,
  GRANTABLE_ROLES,
  ROLE_PERMISSIONS,
  type ContentAction,
  type ContentStatus,
  type ContentType,
  type ContentWorkflowState,
  type Permission,
} from '@aura/contracts';
import { ProblemException, writeOutbox, type AuthenticatedUser } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';

/**
 * The admin content workflow for foods and recipes (admin LLD §2). Published items stay as they
 * are while edits to them wait in `pendingRevision`; the revision has its own state
 * (`revisionStatus`) and replaces the live values only when a reviewer publishes it.
 */

export interface WorkflowRow {
  status: ContentStatus;
  revisionStatus: ContentStatus | null;
  pendingRevision: Prisma.JsonValue | null;
  version: number;
  reviewRequired: string | null;
  publishedAt: Date | null;
}

export type WorkflowStep =
  | { target: 'item'; to: ContentStatus }
  | { target: 'revision'; to: ContentStatus };

const hasRevision = (row: WorkflowRow) => row.pendingRevision !== null && row.revisionStatus !== null;

export function workflowState(row: WorkflowRow): ContentWorkflowState {
  return {
    status: row.status,
    version: row.version,
    revisionStatus: hasRevision(row) ? row.revisionStatus : null,
    reviewRequired: row.reviewRequired,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

/** Where an action leads, or 409 INVALID_TRANSITION. Archive always acts on the live item. */
export function workflowStep(row: WorkflowRow, action: ContentAction): WorkflowStep {
  const revision = hasRevision(row) && action !== 'archive';
  const from = revision ? row.revisionStatus! : row.status;
  const to = contentTransition(action, from);
  if (!to) {
    throw new ProblemException(
      HttpStatus.CONFLICT,
      'INVALID_TRANSITION',
      `Cannot ${action} ${revision ? 'a revision' : 'an item'} that is ${from}`,
    );
  }
  return revision ? { target: 'revision', to } : { target: 'item', to };
}

/** How an edit lands: in place on a draft, or as a revision of a published item. */
export function editTarget(row: WorkflowRow): 'item' | 'revision' {
  if (!hasRevision(row) && row.status === 'DRAFT') return 'item';
  if (row.status === 'PUBLISHED' && (!hasRevision(row) || row.revisionStatus === 'DRAFT')) {
    return 'revision';
  }
  throw new ProblemException(
    HttpStatus.CONFLICT,
    'CONTENT_LOCKED',
    hasRevision(row) || row.status === 'IN_REVIEW'
      ? 'This is in review: reject it to edit'
      : `Cannot edit an item that is ${row.status}`,
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The role the audit log shows: the actor's first role that holds the permission used. */
export function actorRole(actor: AuthenticatedUser, permission: Permission): string {
  return (
    GRANTABLE_ROLES.find(
      (r) => actor.groups.includes(r) && ROLE_PERMISSIONS[r].includes(permission),
    ) ?? 'staff'
  );
}

export interface AuditInput {
  actor: AuthenticatedUser;
  permission: Permission;
  action: string;
  entityType: ContentType;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  requestId: string | undefined;
}

export function audit(tx: Prisma.TransactionClient, input: AuditInput) {
  return writeOutbox(tx, {
    producer: 'nutrition-service',
    key: 'AuditEvent@1',
    userId: null,
    data: {
      actorId: input.actor.userId,
      actorRole: actorRole(input.actor, input.permission),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      requestId: input.requestId && UUID.test(input.requestId) ? input.requestId : null,
    },
  });
}

export function contentPublished(
  tx: Prisma.TransactionClient,
  input: { contentType: ContentType; contentId: string; slug: string | null; version: number; publishedBy: string },
) {
  return writeOutbox(tx, {
    producer: 'nutrition-service',
    key: 'ContentPublished@1',
    userId: null,
    data: input,
  });
}

export const stateOf = (row: WorkflowRow) => ({
  status: row.status,
  revisionStatus: hasRevision(row) ? row.revisionStatus : null,
  version: row.version,
});

/** Request ids the audit log can carry. */
export type HttpReq = { id?: unknown };
export const requestIdOf = (req: HttpReq) => (req.id === undefined ? undefined : String(req.id));
