import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { DATA_PARTICIPANTS, type DeletionScheduledResponse } from '@aura/contracts';
import {
  ProblemException,
  SERVICE_KIT_CONFIG,
  purgeUserData,
  serviceKitMeter,
  writeOutbox,
  type AuthenticatedUser,
  type ObjectStorage,
} from '@aura/service-kit';
import type { ServiceConfig } from '../config';
import type { Prisma } from '../generated/prisma';
import { UserProvisioningService } from '../identity/user-provisioning.service';
import { PrismaService } from '../prisma.service';
import { exportPrefix, userPrefix } from './exports.service';
import { IDENTITY_ADMIN, type IdentityAdmin } from './identity-admin';
import { OBJECT_STORAGE } from './storage';
import { userDataPlan } from './user-data-plan';

const DAY_MS = 86_400_000;

const missingAcks = serviceKitMeter.createCounter('aura.privacy.purge_ack_missing', {
  description: 'Deletions where a service had not confirmed its purge in time (alert on > 0)',
});

/**
 * Account deletion (users LLD §4, TC-PRV-2/3):
 *
 *   ACTIVE --DELETE /v1/me (fresh sign-in)--> PENDING_DELETION --restore (within grace)--> ACTIVE
 *   PENDING_DELETION --grace over: AccountDeleted--> DELETED --all UserDataPurged--> identity,
 *   files and own tables removed; the User row stays as a scrubbed tombstone.
 *
 * The request routes run in the http deployment; the jobs (`run*`) in the worker.
 */
@Injectable()
export class DeletionService {
  private readonly logger = new Logger(DeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: ServiceConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(IDENTITY_ADMIN) private readonly identityAdmin: IdentityAdmin,
  ) {}

  /** DELETE /v1/me. Asking again while pending returns the same date. */
  async request(identity: AuthenticatedUser, now = new Date()): Promise<DeletionScheduledResponse> {
    const authAge = now.getTime() / 1000 - (identity.authTime ?? 0);
    if (authAge > this.config.REAUTH_MAX_AGE_SECONDS) {
      throw new ProblemException(
        HttpStatus.FORBIDDEN,
        'REAUTH_REQUIRED',
        'Sign in again to delete your account',
        `Deleting the account needs a sign-in from the last ${Math.round(this.config.REAUTH_MAX_AGE_SECONDS / 60)} minutes.`,
      );
    }
    const user = await this.provisioning.activeUser(identity, { allowPending: true });
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lockUser(tx, user.id);
      if (locked.status === 'PENDING_DELETION' && locked.deletionDueAt) {
        return { deletionDueAt: locked.deletionDueAt.toISOString() };
      }
      const deletionDueAt = new Date(now.getTime() + this.config.DELETION_GRACE_DAYS * DAY_MS);
      await tx.user.update({
        where: { id: user.id },
        data: { status: 'PENDING_DELETION', deletionDueAt },
      });
      await tx.dataRequest.create({
        data: {
          userId: user.id,
          kind: 'delete',
          status: 'queued',
          createdAt: now,
          dueAt: deletionDueAt,
        },
      });
      await writeOutbox(tx, {
        producer: 'profile-service',
        key: 'AccountDeletionRequested@1',
        userId: user.id,
        data: { userId: user.id, deletionDueAt: deletionDueAt.toISOString() },
        now,
      });
      return { deletionDueAt: deletionDueAt.toISOString() };
    });
  }

  /** POST /v1/me/restore. Restoring an active account is a no-op. */
  async restore(identity: AuthenticatedUser, now = new Date()): Promise<void> {
    const user = await this.provisioning.activeUser(identity, { allowPending: true });
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockUser(tx, user.id);
      if (locked.status !== 'PENDING_DELETION') return;
      if (locked.deletionDueAt && locked.deletionDueAt <= now) {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'RESTORE_WINDOW_CLOSED',
          'The account can no longer be restored',
        );
      }
      await tx.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', deletionDueAt: null },
      });
      await tx.dataRequest.updateMany({
        where: { userId: user.id, kind: 'delete', status: 'queued' },
        data: { status: 'cancelled', completedAt: now },
      });
      await writeOutbox(tx, {
        producer: 'profile-service',
        key: 'AccountRestored@1',
        userId: user.id,
        data: { userId: user.id },
        now,
      });
    });
  }

  /** Worker consumer: one service confirmed it deleted the user's rows. */
  async purgeConfirmed(
    tx: Prisma.TransactionClient,
    ack: { requestId: string; service: string },
    now = new Date(),
  ): Promise<void> {
    await tx.dataRequestPart.updateMany({
      where: { requestId: ack.requestId, service: ack.service, doneAt: null },
      data: { doneAt: now },
    });
  }

  /** Grace period over: mark the account deleted and ask every service to purge (AccountDeleted). */
  async runDueDeletions(now = new Date()): Promise<number> {
    const due = await this.prisma.user.findMany({
      where: { status: 'PENDING_DELETION', deletionDueAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    let started = 0;
    for (const { id } of due) {
      const began = await this.prisma.$transaction(async (tx) => {
        const user = await this.lockUser(tx, id);
        // Restored, or another worker got here first.
        if (user.status !== 'PENDING_DELETION' || !user.deletionDueAt || user.deletionDueAt > now) {
          return false;
        }
        await tx.user.update({ where: { id }, data: { status: 'DELETED' } });
        const queued = await tx.dataRequest.findFirst({
          where: { userId: id, kind: 'delete', status: 'queued' },
          orderBy: { createdAt: 'desc' },
        });
        const parts = DATA_PARTICIPANTS.map((service) => ({ service }));
        // dueAt now marks when the purge was asked for; the acknowledgement alert counts from it.
        const request = queued
          ? await tx.dataRequest.update({
              where: { id: queued.id },
              data: { status: 'running', dueAt: now, parts: { create: parts } },
            })
          : await tx.dataRequest.create({
              data: {
                userId: id,
                kind: 'delete',
                status: 'running',
                dueAt: now,
                parts: { create: parts },
              },
            });
        await writeOutbox(tx, {
          producer: 'profile-service',
          key: 'AccountDeleted@1',
          userId: id,
          data: { userId: id, requestId: request.id },
          now,
        });
        return true;
      });
      if (began) started++;
    }
    return started;
  }

  /**
   * Every service confirmed: delete the sign-in identity and the user's files, then profile-service's
   * own rows, leaving the scrubbed tombstone and the request as the record of the erasure. The
   * external steps are idempotent, so a crash part-way is finished by the next run.
   */
  async runFinishDeletions(now = new Date()): Promise<number> {
    const running = await this.prisma.dataRequest.findMany({
      where: { kind: 'delete', status: 'running', parts: { none: { doneAt: null } } },
      take: 100,
    });
    for (const request of running) {
      await this.identityAdmin.deleteUser(request.userId);
      await this.storage.deletePrefix(userPrefix(request.userId));
      await this.prisma.$transaction(async (tx) => {
        await purgeUserData(tx, userDataPlan, request.userId);
        await tx.user.update({
          where: { id: request.userId },
          data: {
            // Unique and meaningless: the email is gone, the pseudonymous id stays.
            email: `deleted-${request.userId}@deleted.invalid`,
            displayName: null,
            status: 'DELETED',
            deletionDueAt: null,
            lastActiveAt: null,
          },
        });
        await tx.dataRequest.updateMany({
          where: { userId: request.userId, kind: 'export' },
          data: { artifactKey: null },
        });
        await tx.dataRequest.update({
          where: { id: request.id },
          data: { status: 'done', completedAt: now },
        });
      });
      this.logger.log({ msg: 'Account deletion finished', requestId: request.id });
    }
    return running.length;
  }

  /** Raises one alert per deletion that a service has not confirmed in PURGE_ACK_ALERT_HOURS. */
  async runAckAlerts(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - this.config.PURGE_ACK_ALERT_HOURS * 3_600_000);
    const late = await this.prisma.dataRequest.findMany({
      where: { kind: 'delete', status: 'running', alertedAt: null, dueAt: { lte: before } },
      include: { parts: { where: { doneAt: null }, select: { service: true } } },
    });
    for (const request of late) {
      const services = request.parts.map((p) => p.service);
      this.logger.error({
        msg: 'Account deletion not confirmed by every service',
        requestId: request.id,
        services,
      });
      missingAcks.add(1);
      await this.prisma.dataRequest.update({
        where: { id: request.id },
        data: { alertedAt: now },
      });
    }
    return late.length;
  }

  /** Export files are removed after EXPORT_RETENTION_DAYS; stuck exports are failed after the timeout. */
  async runExportHousekeeping(now = new Date()): Promise<{ expired: number; failed: number }> {
    const expired = await this.prisma.dataRequest.findMany({
      where: { kind: 'export', status: 'ready', dueAt: { lte: now } },
      take: 100,
    });
    for (const request of expired) {
      await this.storage.deletePrefix(exportPrefix(request.userId, request.id));
      await this.prisma.dataRequest.update({
        where: { id: request.id },
        data: { status: 'expired', artifactKey: null },
      });
    }
    const timeout = new Date(now.getTime() - this.config.EXPORT_TIMEOUT_MINUTES * 60_000);
    const stuck = await this.prisma.dataRequest.findMany({
      where: { kind: 'export', status: 'running', createdAt: { lte: timeout } },
      include: { parts: { where: { doneAt: null }, select: { service: true } } },
      take: 100,
    });
    for (const request of stuck) {
      this.logger.warn({
        msg: 'Export timed out',
        requestId: request.id,
        services: request.parts.map((p) => p.service),
      });
      await this.storage.deletePrefix(exportPrefix(request.userId, request.id));
      await this.prisma.dataRequest.update({
        where: { id: request.id },
        data: { status: 'failed', completedAt: now },
      });
    }
    return { expired: expired.length, failed: stuck.length };
  }

  private async lockUser(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${id}::uuid FOR UPDATE`;
    return tx.user.findUniqueOrThrow({ where: { id } });
  }
}
