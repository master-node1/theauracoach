import { HttpStatus, Injectable } from '@nestjs/common';
import type { ConsentRecord, ConsentResponse } from '@aura/contracts';
import { ProblemException, writeOutbox, type AuthenticatedUser } from '@aura/service-kit';
import type { Consent } from '../generated/prisma';
import { UserProvisioningService } from '../identity/user-provisioning.service';
import { PrismaService } from '../prisma.service';

function toConsent(row: Consent): ConsentResponse {
  return {
    purpose: row.purpose,
    granted: row.granted,
    policyVersion: row.policyVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Consents are append-only rows (users LLD §2); the latest row per purpose is the current state.
 * Every recorded consent publishes ConsentChanged so coach and notification can update their replica.
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async latest(identity: AuthenticatedUser): Promise<ConsentResponse[]> {
    const user = await this.provisioning.activeUser(identity);
    const rows = await this.prisma.consent.findMany({
      where: { userId: user.id },
      orderBy: [{ purpose: 'asc' }, { createdAt: 'desc' }],
      distinct: ['purpose'],
    });
    return rows.map(toConsent);
  }

  async record(identity: AuthenticatedUser, input: ConsentRecord): Promise<ConsentResponse> {
    const user = await this.provisioning.activeUser(identity);
    if (input.purpose === 'CORE_SERVICE' && !input.granted) {
      // The service cannot run without it; withdrawing it means deleting the account.
      throw new ProblemException(
        HttpStatus.CONFLICT,
        'CORE_CONSENT_REQUIRED',
        'Core service consent can only be withdrawn by deleting the account',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      // Serialise a user's consent writes so "latest" is unambiguous even within one millisecond.
      await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const previous = await tx.consent.findFirst({
        where: { userId: user.id, purpose: input.purpose },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const now = new Date();
      const createdAt =
        previous && previous.createdAt >= now ? new Date(previous.createdAt.getTime() + 1) : now;
      const row = await tx.consent.create({
        data: {
          userId: user.id,
          purpose: input.purpose,
          granted: input.granted,
          policyVersion: input.policyVersion,
          channel: input.channel,
          createdAt,
        },
      });
      await writeOutbox(tx, {
        producer: 'profile-service',
        key: 'ConsentChanged@1',
        userId: user.id,
        data: {
          userId: user.id,
          purpose: row.purpose,
          granted: row.granted,
          policyVersion: row.policyVersion,
        },
      });
      return toConsent(row);
    });
  }
}
