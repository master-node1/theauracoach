import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  DATA_PARTICIPANTS,
  type DataRequestResponse,
  type DataRequestStatus,
} from '@aura/contracts';
import {
  ProblemException,
  SERVICE_KIT_CONFIG,
  exportUserData,
  writeOutbox,
  type AuthenticatedUser,
  type ObjectStorage,
  type UserDataExport,
} from '@aura/service-kit';
import type { ServiceConfig } from '../config';
import type { DataRequest, Prisma } from '../generated/prisma';
import { UserProvisioningService } from '../identity/user-provisioning.service';
import { PrismaService } from '../prisma.service';
import { buildExportArchive } from './export-archive';
import { OBJECT_STORAGE } from './storage';
import { userDataPlan } from './user-data-plan';

const DAY_MS = 86_400_000;

/** Where an export's parts and zip live; under the user's prefix so deletion removes them too. */
export function exportPrefix(userId: string, requestId: string): string {
  return `user-private/${userId}/exports/${requestId}/`;
}

/** Everything under this prefix belongs to the user and goes when the account is deleted. */
export function userPrefix(userId: string): string {
  return `user-private/${userId}/`;
}

function filename(createdAt: Date): string {
  return `auracoach-export-${createdAt.toISOString().slice(0, 10)}.zip`;
}

/**
 * Data export (users LLD §3, TC-PRV-1): POST starts it and asks every participant for its part
 * (ExportRequested); when the last ExportPartReady arrives the parts and profile-service's own
 * tables are zipped. One export runs at a time; a ready export from the last day is returned
 * instead of starting another.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: ServiceConfig,
  ) {}

  async request(
    identity: AuthenticatedUser,
    now = new Date(),
  ): Promise<{ created: boolean; export: DataRequestResponse }> {
    const user = await this.provisioning.activeUser(identity, { allowPending: true });
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serialise a user's requests so two clicks cannot start two exports.
      await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const latest = await tx.dataRequest.findFirst({
        where: { userId: user.id, kind: 'export', status: { in: ['queued', 'running', 'ready'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && latest.status !== 'ready') {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'EXPORT_IN_PROGRESS',
          'An export is already being prepared',
        );
      }
      if (latest && now.getTime() - latest.createdAt.getTime() < DAY_MS) {
        return { created: false, row: latest };
      }
      const row = await tx.dataRequest.create({
        data: {
          userId: user.id,
          kind: 'export',
          status: 'running',
          createdAt: now,
          parts: { create: DATA_PARTICIPANTS.map((service) => ({ service })) },
        },
      });
      await writeOutbox(tx, {
        producer: 'profile-service',
        key: 'ExportRequested@1',
        userId: user.id,
        data: { requestId: row.id, userId: user.id, exportPrefix: exportPrefix(user.id, row.id) },
      });
      return { created: true, row };
    });
    return { created: outcome.created, export: await this.toResponse(outcome.row) };
  }

  async list(identity: AuthenticatedUser): Promise<DataRequestResponse[]> {
    const user = await this.provisioning.activeUser(identity, { allowPending: true });
    const rows = await this.prisma.dataRequest.findMany({
      where: { userId: user.id, kind: 'export' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return Promise.all(rows.map((r) => this.toResponse(r)));
  }

  /** Another user's export is "not found", never "forbidden" (no existence oracle). */
  async get(identity: AuthenticatedUser, id: string): Promise<DataRequestResponse> {
    const user = await this.provisioning.activeUser(identity, { allowPending: true });
    const row = await this.prisma.dataRequest.findFirst({
      where: { id, userId: user.id, kind: 'export' },
    });
    if (!row) throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Export not found');
    return this.toResponse(row);
  }

  /**
   * Records one participant's part; when every part is in, builds the zip. Runs in the event
   * consumer's transaction, so a failure leaves the event to be retried.
   */
  async partReady(
    tx: Prisma.TransactionClient,
    part: { requestId: string; service: string; key: string; rows: number },
    now = new Date(),
  ): Promise<void> {
    const request = await tx.dataRequest.findUnique({ where: { id: part.requestId } });
    // A part for an export that already failed or expired is ignored.
    if (!request || request.kind !== 'export' || request.status !== 'running') return;
    await tx.dataRequestPart.updateMany({
      where: { requestId: part.requestId, service: part.service },
      data: { key: part.key, rows: part.rows, doneAt: now },
    });
    // Lock the request so the last two parts arriving together build the zip once.
    await tx.$queryRaw`SELECT 1 FROM "DataRequest" WHERE "id" = ${part.requestId}::uuid FOR UPDATE`;
    const parts = await tx.dataRequestPart.findMany({ where: { requestId: part.requestId } });
    if (parts.some((p) => !p.doneAt || !p.key)) return;
    const fresh = await tx.dataRequest.findUniqueOrThrow({ where: { id: part.requestId } });
    if (fresh.status !== 'running') return;

    const collected: UserDataExport[] = [await exportUserData(tx, userDataPlan, fresh.userId, now)];
    for (const p of parts) {
      collected.push(JSON.parse((await this.storage.get(p.key as string)).toString()));
    }
    const key = `${exportPrefix(fresh.userId, fresh.id)}${filename(fresh.createdAt)}`;
    await this.storage.put(key, buildExportArchive(collected, now), 'application/zip');
    await tx.dataRequest.update({
      where: { id: fresh.id },
      data: {
        status: 'ready',
        artifactKey: key,
        completedAt: now,
        dueAt: new Date(now.getTime() + this.config.EXPORT_RETENTION_DAYS * DAY_MS),
      },
    });
  }

  private async toResponse(row: DataRequest): Promise<DataRequestResponse> {
    let download: { url: string; expiresAt: Date } | null = null;
    if (row.status === 'ready' && row.artifactKey) {
      download = await this.storage.presignGet(row.artifactKey, {
        expiresInSeconds: this.config.EXPORT_LINK_TTL_SECONDS,
        filename: filename(row.createdAt),
      });
    }
    return {
      id: row.id,
      kind: row.kind as DataRequestResponse['kind'],
      status: row.status as DataRequestStatus,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      downloadUrl: download?.url ?? null,
      downloadExpiresAt: download?.expiresAt.toISOString() ?? null,
      expiresAt: row.status === 'ready' ? (row.dueAt?.toISOString() ?? null) : null,
    };
  }
}
