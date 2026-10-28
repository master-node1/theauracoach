import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  GRANTABLE_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSIONS,
  type GrantableRole,
  type RoleGrant,
  type RoleGrantInput,
  type RoleListResponse,
} from '@aura/contracts';
import { ProblemException, writeOutbox, type AuthenticatedUser } from '@aura/service-kit';
import type { Prisma } from '../generated/prisma';
import { IDENTITY_GROUPS, type IdentityGroups } from '../identity/identity-groups';
import { PrismaService } from '../prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type GrantRow = { userId: string; roleId: string; grantedBy: string | null; grantedAt: Date };

function toGrant(row: GrantRow, email: string): RoleGrant {
  return {
    userId: row.userId,
    email,
    role: row.roleId as GrantableRole,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt.toISOString(),
  };
}

/** The role the audit log shows for the actor: the one that let them grant roles. */
function actorRole(actor: AuthenticatedUser): string {
  return (
    actor.groups.find((g) =>
      (ROLE_PERMISSIONS[g as GrantableRole] as readonly string[] | undefined)?.includes(
        'role:grant',
      ),
    ) ?? 'staff'
  );
}

/**
 * Grants and revokes staff roles (auth LLD §4). profile-service is the source of truth; each change
 * is mirrored to the identity provider's groups and audited, all in one transaction: if the
 * identity call fails, nothing is committed. A revoked role leaves the user's tokens at the next
 * refresh, so within the 15-minute access-token lifetime.
 */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(IDENTITY_GROUPS) private readonly identity: IdentityGroups,
  ) {}

  async list(): Promise<RoleListResponse> {
    const rows = await this.prisma.userRole.findMany({
      include: { user: { select: { email: true } } },
      orderBy: [{ roleId: 'asc' }, { grantedAt: 'asc' }],
    });
    return {
      roles: GRANTABLE_ROLES.map((id) => ({
        id,
        description: ROLE_DESCRIPTIONS[id],
        permissions: [...ROLE_PERMISSIONS[id]],
      })),
      grants: rows.map((r) => toGrant(r, r.user.email)),
    };
  }

  /** Returns the grant and whether it was created now (false: it already existed). */
  async grant(
    actor: AuthenticatedUser,
    input: RoleGrantInput,
    requestId: string | undefined,
  ): Promise<{ grant: RoleGrant; created: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: input.userId ? { id: input.userId } : { email: input.email! },
      select: { id: true, email: true, status: true },
    });
    if (!user || user.status === 'DELETED') {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'No such user');
    }
    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId: user.id, roleId: input.role } },
    });
    if (existing) return { grant: toGrant(existing, user.email), created: false };

    const row = await this.inIdentityTransaction(async (tx) => {
      const created = await tx.userRole.create({
        data: { userId: user.id, roleId: input.role, grantedBy: actor.userId },
      });
      await this.audit(tx, actor, 'role.grant', user.id, input.role, requestId, false);
      await this.identity.addUserToGroup(user.id, input.role);
      return created;
    });
    return { grant: toGrant(row, user.email), created: true };
  }

  async revoke(
    actor: AuthenticatedUser,
    userId: string,
    role: GrantableRole,
    requestId: string | undefined,
  ): Promise<void> {
    await this.inIdentityTransaction(async (tx) => {
      if (role === 'owner') {
        // Lock the owner grants so two revocations cannot both pass the last-owner check.
        const owners = await tx.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM "UserRole" WHERE "roleId" = 'owner' FOR UPDATE`;
        if (owners.some((o) => o.userId === userId) && owners.length === 1) {
          throw new ProblemException(
            HttpStatus.CONFLICT,
            'LAST_OWNER',
            'Grant owner to someone else before removing the last owner',
          );
        }
      }
      const deleted = await tx.userRole.deleteMany({ where: { userId, roleId: role } });
      if (deleted.count === 0) {
        throw new ProblemException(HttpStatus.NOT_FOUND, 'ROLE_GRANT_NOT_FOUND', 'No such grant');
      }
      await this.audit(tx, actor, 'role.revoke', userId, role, requestId, true);
      await this.identity.removeUserFromGroup(userId, role);
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    actor: AuthenticatedUser,
    action: 'role.grant' | 'role.revoke',
    userId: string,
    role: GrantableRole,
    requestId: string | undefined,
    revoked: boolean,
  ) {
    const state = { userId, role };
    return writeOutbox(tx, {
      producer: 'profile-service',
      key: 'AuditEvent@1',
      userId,
      data: {
        actorId: actor.userId,
        actorRole: actorRole(actor),
        action,
        entityType: 'user_role',
        entityId: `${userId}:${role}`,
        before: revoked ? state : null,
        after: revoked ? null : state,
        requestId: requestId && UUID.test(requestId) ? requestId : null,
      },
    });
  }

  /** Runs `fn` in a transaction; an identity-provider failure rolls it back and answers 503. */
  private async inIdentityTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (err) {
      if (err instanceof ProblemException) throw err;
      if (err instanceof Error && '$metadata' in err) {
        this.logger.error({ err }, 'Identity provider group change failed');
        throw new ProblemException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'IDENTITY_UNAVAILABLE',
          'Could not update sign-in groups; nothing was changed',
        );
      }
      throw err;
    }
  }
}
