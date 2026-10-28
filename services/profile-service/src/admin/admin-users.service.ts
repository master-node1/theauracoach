import { HttpStatus, Injectable } from '@nestjs/common';
import {
  maskEmail,
  type AdminField,
  type AdminUserAccount,
  type AdminUserLookup,
} from '@aura/contracts';
import {
  actorRoleFor,
  ProblemException,
  writeOutbox,
  type AuthenticatedUser,
} from '@aura/service-kit';
import { PrismaService } from '../prisma.service';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * The account part of the masked support view (admin LLD §6, TAC-32). Support staff see enough
 * to help someone (status, settings, consents, roles), never the full email, profile details or
 * health data. Every view is audited.
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(email: string): Promise<AdminUserLookup> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, status: true, createdAt: true },
    });
    if (!user) throw new ProblemException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'No such user');
    return {
      userId: user.id,
      emailMasked: maskEmail(user.email),
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async view(
    actor: AuthenticatedUser,
    userId: string,
    requestId: string | null,
  ): Promise<AdminUserAccount> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: {
          roles: { select: { roleId: true } },
          onboarding: { select: { status: true } },
          consents: {
            orderBy: { createdAt: 'desc' },
            distinct: ['purpose'],
            select: { purpose: true, granted: true, policyVersion: true },
          },
        },
      });
      if (!user) {
        throw new ProblemException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'No such user');
      }
      await writeOutbox(tx, {
        producer: 'profile-service',
        key: 'AuditEvent@1',
        userId,
        data: {
          actorId: actor.userId,
          actorRole: actorRoleFor(actor, 'user:support_read'),
          action: 'user.support_view',
          entityType: 'user',
          entityId: userId,
          before: null,
          after: null,
          requestId,
        },
      });
      const fields: AdminField[] = [
        { label: 'Status', value: user.status },
        { label: 'Joined', value: iso(user.createdAt) },
        { label: 'Last active', value: iso(user.lastActiveAt) },
        { label: 'Deletion due', value: iso(user.deletionDueAt) },
        { label: 'Time zone', value: user.timezone },
        { label: 'Language', value: user.locale },
        { label: 'Onboarding', value: user.onboarding?.status ?? 'NOT_STARTED' },
        { label: 'Staff roles', value: user.roles.map((r) => r.roleId).join(', ') || 'none' },
        ...user.consents
          .sort((a, b) => a.purpose.localeCompare(b.purpose))
          .map((c) => ({
            label: `Consent: ${c.purpose}`,
            value: `${c.granted ? 'granted' : 'withdrawn'} (${c.policyVersion})`,
          })),
      ];
      return {
        service: 'profile',
        title: 'Account',
        userId: user.id,
        emailMasked: maskEmail(user.email),
        fields,
      };
    });
  }
}
