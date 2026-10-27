import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DATA_PARTICIPANTS } from '@aura/contracts';
import {
  configureHttpApp,
  exportJson,
  remainingUserRows,
  UserTokenVerifier,
  type ObjectStorage,
} from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { strFromU8, unzipSync } from 'fflate';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';
import { DeletionService } from '../src/privacy/deletion.service';
import { ExportsService, exportPrefix } from '../src/privacy/exports.service';
import { NoIdentityAdmin } from '../src/privacy/identity-admin';
import { OBJECT_STORAGE } from '../src/privacy/storage';
import { userDataPlan } from '../src/privacy/user-data-plan';
import { PrismaService } from '../src/prisma.service';

const DAY = 86_400_000;
let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let prisma: PrismaService;
let storage: ObjectStorage;
let exports: ExportsService;
let deletion: DeletionService;
let storageDir: string;
const identity = new NoIdentityAdmin();

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'profile_privacy');
  dev = await createDevIssuer();
  storageDir = await mkdtemp(join(tmpdir(), 'aura-profile-'));
  const config = loadServiceConfig({
    ...testEnv({
      service: 'profile-service',
      databaseUrl: db.url,
      issuer: dev.issuer,
      redisDb: 13,
    }),
    OBJECT_STORAGE_DIR: storageDir,
    OBJECT_STORAGE_PUBLIC_URL: 'http://localhost/v1/me/export-files',
    IDENTITY_ADMIN: 'none',
  });
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier, undefined, { identityAdmin: identity })],
  }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
  prisma = app.get(PrismaService);
  storage = app.get(OBJECT_STORAGE);
  exports = app.get(ExportsService);
  deletion = app.get(DeletionService);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
  if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

const http = () => request(app.getHttpServer());

/** A signed-in user with a profile and consents. `authTime` defaults to a fresh sign-in. */
async function signUp() {
  const id = randomUUID();
  const email = `u-${id}@example.com`;
  const token = (authTime = Math.floor(Date.now() / 1000)) =>
    dev.mintAccessToken({ sub: id, email, authTime });
  const fresh = await token();
  await http().get('/v1/me').set('authorization', `Bearer ${fresh}`).expect(200);
  await http()
    .post('/v1/me/consents')
    .set('authorization', `Bearer ${fresh}`)
    .send({ purpose: 'AI_COACH', granted: true, policyVersion: '2026-10' })
    .expect(201);
  await prisma.profile.create({
    data: {
      userId: id,
      dateOfBirth: new Date('1992-03-01'),
      sex: 'FEMALE',
      heightCm: 162,
      activityLevel: 'LIGHT',
      experience: 'BEGINNER',
      dietType: 'VEGETARIAN',
      cuisines: ['south_indian'],
      allergens: [],
      dislikedFoodIds: [],
      fastingDays: [],
      trainingDays: [1, 3, 5],
      location: 'HOME',
      equipmentCodes: ['dumbbell'],
    },
  });
  return { id, email, token, fresh };
}

async function outbox(type: string, userId: string) {
  return prisma.outboxEvent.findMany({ where: { type, userId }, orderBy: { createdAt: 'asc' } });
}

/** Stands in for the six participant workers answering ExportRequested. */
async function deliverParts(userId: string, requestId: string) {
  for (const service of DATA_PARTICIPANTS) {
    const key = `${exportPrefix(userId, requestId)}${service}.json`;
    const part = {
      service,
      userId,
      generatedAt: new Date().toISOString(),
      tables: { Example: [{ id: 1, userId, note: '=HYPERLINK("x")' }] },
    };
    await storage.put(key, exportJson(part), 'application/json');
    await prisma.$transaction((tx) => exports.partReady(tx, { requestId, service, key, rows: 1 }));
  }
}

describe('data export (TC-PRV-1)', () => {
  it('collects every part into one zip with JSON and CSV, behind a short-lived link', async () => {
    const user = await signUp();
    const other = await signUp();
    const auth = { authorization: `Bearer ${user.fresh}` };

    const started = await http().post('/v1/me/exports').set(auth).expect(202);
    expect(started.body).toMatchObject({ kind: 'export', status: 'running', downloadUrl: null });
    const [requested] = await outbox('ExportRequested', user.id);
    expect((requested?.payload as { data: unknown }).data).toEqual({
      requestId: started.body.id,
      userId: user.id,
      exportPrefix: exportPrefix(user.id, started.body.id),
    });

    const again = await http().post('/v1/me/exports').set(auth).expect(409);
    expect(again.body.code).toBe('EXPORT_IN_PROGRESS');

    await deliverParts(user.id, started.body.id);
    const ready = await http().get(`/v1/me/exports/${started.body.id}`).set(auth).expect(200);
    expect(ready.body).toMatchObject({ status: 'ready', downloadUrl: expect.any(String) });
    expect(Date.parse(ready.body.downloadExpiresAt) - Date.now()).toBeLessThanOrEqual(900_000);

    const link = new URL(ready.body.downloadUrl);
    const file = await http()
      .get(`${link.pathname}${link.search}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers['content-disposition']).toMatch(/^attachment; filename="auracoach-export-/);
    const zip = unzipSync(new Uint8Array(file.body as Buffer));
    const names = Object.keys(zip);
    expect(names).toEqual(
      expect.arrayContaining([
        'README.txt',
        'json/profile.json',
        'csv/profile/User.csv',
        'csv/profile/Consent.csv',
        'csv/profile/Profile.csv',
        ...DATA_PARTICIPANTS.map((s) => `json/${s.replace(/-service$/, '')}.json`),
      ]),
    );
    const own = JSON.parse(strFromU8(zip['json/profile.json']!));
    expect(own.tables.User[0]).toMatchObject({ id: user.id, email: user.email });
    expect(Object.keys(own.tables)).not.toContain('DataRequestPart');
    expect(JSON.stringify(own)).not.toContain(other.id);
    // Spreadsheet formulas in user text are neutralised in CSV.
    expect(strFromU8(zip['csv/workout/Example.csv']!)).toContain(`"'=HYPERLINK(""x"")"`);

    const tampered = new URL(link);
    tampered.searchParams.set('key', `user-private/${other.id}/x.zip`);
    await http().get(`${tampered.pathname}${tampered.search}`).expect(404);

    // A ready export from today is returned instead of starting another.
    const repeat = await http().post('/v1/me/exports').set(auth).expect(200);
    expect(repeat.body.id).toBe(started.body.id);

    // Someone else's export does not exist for them.
    await http()
      .get(`/v1/me/exports/${started.body.id}`)
      .set('authorization', `Bearer ${other.fresh}`)
      .expect(404);

    const list = await http().get('/v1/me/exports').set(auth).expect(200);
    expect(list.body.map((e: { id: string }) => e.id)).toEqual([started.body.id]);

    // After the retention window the file is gone and the link with it.
    await deletion.runExportHousekeeping(new Date(Date.now() + 8 * DAY));
    const expired = await http().get(`/v1/me/exports/${started.body.id}`).set(auth).expect(200);
    expect(expired.body).toMatchObject({ status: 'expired', downloadUrl: null });
    await expect(
      storage.get(`${exportPrefix(user.id, started.body.id)}workout-service.json`),
    ).rejects.toThrow();
  });

  it('fails an export whose parts never all arrive, so a new one can start', async () => {
    const user = await signUp();
    const auth = { authorization: `Bearer ${user.fresh}` };
    const started = await http().post('/v1/me/exports').set(auth).expect(202);
    const result = await deletion.runExportHousekeeping(new Date(Date.now() + 61 * 60_000));
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const failed = await http().get(`/v1/me/exports/${started.body.id}`).set(auth).expect(200);
    expect(failed.body.status).toBe('failed');
    await http().post('/v1/me/exports').set(auth).expect(202);
  });
});

describe('account deletion and restore (TC-PRV-3)', () => {
  it('needs a recent sign-in', async () => {
    const user = await signUp();
    const stale = await user.token(Math.floor(Date.now() / 1000) - 600);
    const res = await http().delete('/v1/me').set('authorization', `Bearer ${stale}`).expect(403);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
    expect(await outbox('AccountDeletionRequested', user.id)).toHaveLength(0);
  });

  it('locks the account for 30 days and restores it with data intact', async () => {
    const user = await signUp();
    const auth = { authorization: `Bearer ${user.fresh}` };
    const res = await http().delete('/v1/me').set(auth).expect(202);
    const due = Date.parse(res.body.deletionDueAt);
    expect(due - Date.now()).toBeGreaterThan(29.9 * DAY);
    expect(due - Date.now()).toBeLessThanOrEqual(30 * DAY);
    expect(await outbox('AccountDeletionRequested', user.id)).toHaveLength(1);

    // Asking twice keeps the first date and publishes once.
    const again = await http().delete('/v1/me').set(auth).expect(202);
    expect(again.body.deletionDueAt).toBe(res.body.deletionDueAt);
    expect(await outbox('AccountDeletionRequested', user.id)).toHaveLength(1);

    const me = await http().get('/v1/me').set(auth).expect(200);
    expect(me.body).toMatchObject({
      status: 'PENDING_DELETION',
      deletionDueAt: res.body.deletionDueAt,
    });
    const locked = await http().get('/v1/me/consents').set(auth).expect(423);
    expect(locked.body.code).toBe('ACCOUNT_PENDING_DELETION');
    await http().patch('/v1/me/profile').set(auth).send({ displayName: 'X' }).expect(423);
    // Export still works while pending.
    await http().post('/v1/me/exports').set(auth).expect(202);

    await http().post('/v1/me/restore').set(auth).expect(204);
    const restored = await http().get('/v1/me').set(auth).expect(200);
    expect(restored.body).toMatchObject({ status: 'ACTIVE', deletionDueAt: null });
    const consents = await http().get('/v1/me/consents').set(auth).expect(200);
    expect(consents.body).toEqual([
      expect.objectContaining({ purpose: 'AI_COACH', granted: true }),
    ]);
    expect(await outbox('AccountRestored', user.id)).toHaveLength(1);
    const request = await prisma.dataRequest.findFirst({
      where: { userId: user.id, kind: 'delete' },
    });
    expect(request?.status).toBe('cancelled');

    // Restoring an active account changes nothing.
    await http().post('/v1/me/restore').set(auth).expect(204);
    expect(await outbox('AccountRestored', user.id)).toHaveLength(1);
  });

  it('cannot be restored once the grace period is over', async () => {
    const user = await signUp();
    const auth = { authorization: `Bearer ${user.fresh}` };
    await http().delete('/v1/me').set(auth).expect(202);
    await prisma.user.update({
      where: { id: user.id },
      data: { deletionDueAt: new Date(Date.now() - 1000) },
    });
    const res = await http().post('/v1/me/restore').set(auth).expect(409);
    expect(res.body.code).toBe('RESTORE_WINDOW_CLOSED');
  });
});

describe('hard delete after the grace period (TC-PRV-2)', () => {
  it('asks every service to purge, alerts once on a missing confirmation, then erases', async () => {
    const user = await signUp();
    const auth = { authorization: `Bearer ${user.fresh}` };
    await http().post('/v1/me/exports').set(auth).expect(202);
    const exportRow = await prisma.dataRequest.findFirstOrThrow({
      where: { userId: user.id, kind: 'export' },
    });
    await deliverParts(user.id, exportRow.id);
    await http().delete('/v1/me').set(auth).expect(202);

    // Not yet due: nothing happens to this account.
    await deletion.runDueDeletions(new Date());
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      status: 'PENDING_DELETION',
    });
    const t31 = new Date(Date.now() + 31 * DAY);
    expect(await deletion.runDueDeletions(t31)).toBeGreaterThanOrEqual(1);
    const [deleted] = await outbox('AccountDeleted', user.id);
    const requestId = (deleted?.payload as { data: { requestId: string } }).data.requestId;
    expect((deleted?.payload as { data: unknown }).data).toEqual({ userId: user.id, requestId });
    await http().get('/v1/me').set(auth).expect(403);
    await http().post('/v1/me/restore').set(auth).expect(403);

    // Five of six services confirm; the sixth is late.
    const [late, ...prompt] = DATA_PARTICIPANTS;
    for (const service of prompt) {
      await prisma.$transaction((tx) => deletion.purgeConfirmed(tx, { requestId, service }));
    }
    await deletion.runFinishDeletions(t31);
    expect(identity.deleted).not.toContain(user.id);
    const t32 = new Date(t31.getTime() + 25 * 3_600_000);
    expect(await deletion.runAckAlerts(t32)).toBeGreaterThanOrEqual(1);
    const alerted = await prisma.dataRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(alerted.alertedAt).toEqual(t32);
    // Raised once per deletion, not on every run.
    expect(await deletion.runAckAlerts(new Date(t32.getTime() + 3_600_000))).toBe(0);

    await prisma.$transaction((tx) => deletion.purgeConfirmed(tx, { requestId, service: late }));
    await deletion.runFinishDeletions(t32);
    expect(identity.deleted).toContain(user.id);
    await expect(
      storage.get(`${exportPrefix(user.id, exportRow.id)}workout-service.json`),
    ).rejects.toThrow();
    expect(await remainingUserRows(prisma, userDataPlan, user.id)).toEqual({});
    const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(tombstone).toMatchObject({
      status: 'DELETED',
      email: `deleted-${user.id}@deleted.invalid`,
      displayName: null,
    });
    const record = await prisma.dataRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { parts: true },
    });
    expect(record.status).toBe('done');
    expect(record.parts.every((p) => p.doneAt)).toBe(true);

    // An old token cannot bring the account back.
    await http().get('/v1/me').set(auth).expect(403);
  });
});
