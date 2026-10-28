import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureHttpApp, UserTokenVerifier } from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig } from '../src/config';
import { PrismaService } from '../src/prisma.service';

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let prisma: PrismaService;
const OWNER = randomUUID();
const ACTOR = randomUUID();

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'audit_admin');
  dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'audit-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 9 }),
  );
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier)],
  }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
  prisma = app.get(PrismaService);

  // Five entries an hour apart, oldest first: 3 role changes, 1 policy change, 1 consent.
  const base = Date.parse('2026-10-27T05:00:00.000Z');
  const rows = [
    { action: 'role.grant', entityType: 'user_role', entityId: 'u1:support', actorId: ACTOR },
    { action: 'role.grant', entityType: 'user_role', entityId: 'u2:support', actorId: ACTOR },
    { action: 'role.revoke', entityType: 'user_role', entityId: 'u1:support', actorId: OWNER },
    { action: 'policy.update', entityType: 'policy', entityId: 'deficit-floor', actorId: ACTOR },
    { action: 'consent.grant', entityType: 'consent', entityId: 'u3', actorId: null },
  ];
  for (const [i, r] of rows.entries()) {
    await prisma.auditLog.create({
      data: {
        ...r,
        actorRole: r.actorId ? 'owner' : 'user',
        before: i === 3 ? { value: 1200, email: 'someone@example.com' } : undefined,
        after: i === 3 ? { value: 1400, email: 'someone@example.com' } : undefined,
        reason: i === 2 ? 'left the team' : null,
        createdAt: new Date(base + i * 3_600_000),
      },
    });
  }
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const token = (groups = ['owner'], amr = ['pwd', 'mfa']) =>
  dev.mintAccessToken({ sub: OWNER, email: 'owner@example.com', groups, amr });
const get = async (path: string, groups?: string[], amr?: string[]) =>
  request(app.getHttpServer())
    .get(path)
    .set('authorization', `Bearer ${await token(groups, amr)}`);

describe('GET /v1/admin/audit', () => {
  it('needs audit:read and MFA', async () => {
    expect((await get('/v1/admin/audit', ['support'])).body).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect((await get('/v1/admin/audit', ['owner'], ['pwd'])).body).toMatchObject({
      status: 403,
      code: 'MFA_REQUIRED',
    });
  });

  it('pages newest first with a cursor', async () => {
    const first = await get('/v1/admin/audit?limit=2');
    expect(first.status).toBe(200);
    expect(first.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'consent.grant',
      'policy.update',
    ]);
    const second = await get(`/v1/admin/audit?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.entries.map((e: { entityId: string }) => e.entityId)).toEqual([
      'u1:support',
      'u2:support',
    ]);
    const last = await get(`/v1/admin/audit?limit=2&cursor=${second.body.nextCursor}`);
    expect(last.body).toMatchObject({ nextCursor: null });
    expect(last.body.entries).toHaveLength(1);
  });

  it('filters by action prefix, entity, actor and time, oldest first on request', async () => {
    const roles = await get('/v1/admin/audit?action=role&order=asc');
    expect(roles.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'role.grant',
      'role.grant',
      'role.revoke',
    ]);
    const entity = await get('/v1/admin/audit?entityType=user_role&entityId=u1:support');
    expect(entity.body.entries).toHaveLength(2);
    const actor = await get(`/v1/admin/audit?actorId=${OWNER}`);
    expect(actor.body.entries).toHaveLength(1);
    expect(actor.body.entries[0]).toMatchObject({ action: 'role.revoke', reason: 'left the team' });
    const window = await get(
      '/v1/admin/audit?from=2026-10-27T06:00:00.000Z&to=2026-10-27T07:30:00.000Z',
    );
    expect(window.body.entries).toHaveLength(2);
    expect((await get('/v1/admin/audit?actorId=nope')).status).toBe(422);
  });

  it('shows one entry with sensitive fields removed', async () => {
    const list = await get('/v1/admin/audit?action=policy.update');
    const id = list.body.entries[0].id as string;
    const res = await get(`/v1/admin/audit/${id}`);
    expect(res.body).toMatchObject({
      id,
      before: { value: 1200, email: '[removed]' },
      after: { value: 1400, email: '[removed]' },
    });
    expect((await get('/v1/admin/audit/999999')).status).toBe(404);
    expect((await get('/v1/admin/audit/abc')).status).toBe(404);
  });

  it('exports CSV and records the export', async () => {
    const res = await get('/v1/admin/audit/export.csv?action=role');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('audit-log.csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'id,createdAt,actorId,actorRole,action,entityType,entityId,reason,requestId,before,after',
    );
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('left the team');
    const exported = await prisma.auditLog.findFirst({ where: { action: 'audit.export' } });
    expect(exported).toMatchObject({ actorId: OWNER, actorRole: 'owner' });
    expect(exported?.after).toMatchObject({ filters: { action: 'role' }, rows: 3 });
  });
});

describe('append-only', () => {
  it('has no route that changes or deletes an entry', async () => {
    const auth = `Bearer ${await token()}`;
    const server = () => request(app.getHttpServer());
    for (const call of [
      () => server().put('/v1/admin/audit/1'),
      () => server().patch('/v1/admin/audit/1'),
      () => server().delete('/v1/admin/audit/1'),
    ]) {
      const res = await call().set('authorization', auth);
      expect(res.status).toBe(404);
    }
  });

  it('refuses UPDATE, DELETE and TRUNCATE in the database itself', async () => {
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "action" = 'x.y'`),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE "AuditLog"`)).rejects.toThrow(/append-only/);
  });
});

describe('admin operations routes', () => {
  it('answer for this service only, with their permissions', async () => {
    expect((await get('/v1/admin/ops/audit/queues')).body).toMatchObject({
      service: 'audit',
      outboxPending: 0,
      dlqLength: 0,
    });
    expect((await get('/v1/admin/ops/coach/queues')).status).toBe(404);
    expect((await get('/v1/admin/ops/audit/dlq', ['support'])).status).toBe(403);
    expect((await get('/v1/admin/ops/audit/dlq')).body).toMatchObject({ total: 0, entries: [] });
    // audit-service has no support-view section
    expect((await get(`/v1/admin/ops/audit/users/${OWNER}`)).status).toBe(404);
  });
});
