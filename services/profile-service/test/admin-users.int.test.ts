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
import type { IdentityGroups } from '../src/identity/identity-groups';
import { PrismaService } from '../src/prisma.service';

const groups: IdentityGroups = {
  addUserToGroup: async () => undefined,
  removeUserFromGroup: async () => undefined,
};

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let prisma: PrismaService;
const STAFF = randomUUID();

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'profile_admin');
  dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'profile-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 10 }),
  );
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier, undefined, groups)],
  }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const api = () => request(app.getHttpServer());
const staff = (roles: string[], amr = ['pwd', 'mfa']) =>
  dev.mintAccessToken({ sub: STAFF, email: 'staff@example.com', groups: roles, amr });

async function createUser(email: string): Promise<string> {
  const sub = randomUUID();
  await api()
    .get('/v1/me')
    .set('authorization', `Bearer ${await dev.mintAccessToken({ sub, email })}`)
    .expect(200);
  return sub;
}

const audits = (userId: string, action: string) =>
  prisma.outboxEvent
    .findMany({ where: { userId, type: 'AuditEvent' } })
    .then((rows) =>
      rows
        .map((r) => (r.payload as { data: Record<string, unknown> }).data)
        .filter((d) => d.action === action),
    );

describe('/v1/admin/users (support view)', () => {
  it('needs user:support_read and MFA', async () => {
    const userId = await createUser('needs-perm@example.com');
    const editor = await api()
      .get(`/v1/admin/users/${userId}`)
      .set('authorization', `Bearer ${await staff(['content_editor'])}`);
    expect(editor.body).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    const noMfa = await api()
      .get(`/v1/admin/users/${userId}`)
      .set('authorization', `Bearer ${await staff(['support'], ['pwd'])}`);
    expect(noMfa.body).toMatchObject({ status: 403, code: 'MFA_REQUIRED' });
    expect(await audits(userId, 'user.support_view')).toEqual([]);
  });

  it('finds an account by email and answers with a masked address', async () => {
    const userId = await createUser('Priya.Sharma@example.com');
    const res = await api()
      .get('/v1/admin/users?email=priya.sharma@EXAMPLE.com')
      .set('authorization', `Bearer ${await staff(['support'])}`)
      .expect(200);
    expect(res.body).toMatchObject({ userId, emailMasked: 'Pr***@e***.com', status: 'ACTIVE' });
    expect(JSON.stringify(res.body)).not.toContain('sharma');
    const missing = await api()
      .get('/v1/admin/users?email=nobody@example.com')
      .set('authorization', `Bearer ${await staff(['support'])}`);
    expect(missing.body).toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
  });

  it('shows the masked account and audits every view', async () => {
    const userId = await createUser('asha.rao@example.com');
    const token = await staff(['support']);
    const res = await api()
      .get(`/v1/admin/users/${userId}`)
      .set('authorization', `Bearer ${token}`)
      .set('x-request-id', '5b0f4f1c-6d38-4e55-9a9e-6a1f8d7c2b10')
      .expect(200);
    expect(res.body).toMatchObject({
      service: 'profile',
      title: 'Account',
      userId,
      emailMasked: 'as***@e***.com',
    });
    const labels = res.body.fields.map((f: { label: string }) => f.label);
    expect(labels).toEqual(expect.arrayContaining(['Status', 'Last active', 'Staff roles']));
    expect(JSON.stringify(res.body)).not.toContain('asha.rao');

    await api().get(`/v1/admin/users/${userId}`).set('authorization', `Bearer ${token}`);
    const views = await audits(userId, 'user.support_view');
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({
      actorId: STAFF,
      actorRole: 'support',
      entityType: 'user',
      entityId: userId,
      requestId: '5b0f4f1c-6d38-4e55-9a9e-6a1f8d7c2b10',
    });
  });

  it('answers 404 for an unknown id without auditing', async () => {
    const unknown = randomUUID();
    const res = await api()
      .get(`/v1/admin/users/${unknown}`)
      .set('authorization', `Bearer ${await staff(['support'])}`);
    expect(res.body).toMatchObject({ status: 404, code: 'USER_NOT_FOUND' });
    expect(await audits(unknown, 'user.support_view')).toEqual([]);
  });
});

describe('role changes with a reason', () => {
  it('records the reason on grant and revoke', async () => {
    const userId = await createUser('reasoned@example.com');
    const token = await staff(['owner']);
    await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ userId, role: 'support', reason: 'joined support' })
      .expect(201);
    await api()
      .delete(`/v1/admin/roles/${userId}/support?reason=${encodeURIComponent('moved team')}`)
      .set('authorization', `Bearer ${token}`)
      .expect(204);
    expect((await audits(userId, 'role.grant'))[0]).toMatchObject({ reason: 'joined support' });
    expect((await audits(userId, 'role.revoke'))[0]).toMatchObject({ reason: 'moved team' });
    const tooShort = await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ userId, role: 'support', reason: 'x' });
    expect(tooShort.status).toBe(422);
  });
});

describe('activity and usage', () => {
  it('records last activity on /v1/me at most hourly and counts it as active', async () => {
    const userId = await createUser('active@example.com');
    const first = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(first.lastActiveAt).not.toBeNull();
    await api()
      .get('/v1/me')
      .set(
        'authorization',
        `Bearer ${await dev.mintAccessToken({ sub: userId, email: 'active@example.com' })}`,
      )
      .expect(200);
    const second = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(second.lastActiveAt).toEqual(first.lastActiveAt);

    const usage = await api()
      .get('/v1/admin/ops/profile/usage')
      .set('authorization', `Bearer ${await staff(['owner'])}`)
      .expect(200);
    const metric = (key: string) =>
      usage.body.metrics.find((m: { key: string }) => m.key === key)?.value as number;
    expect(usage.body.service).toBe('profile');
    expect(metric('dau')).toBeGreaterThanOrEqual(1);
    expect(metric('signups_7d')).toBeGreaterThanOrEqual(1);
    const support = await api()
      .get('/v1/admin/ops/profile/usage')
      .set('authorization', `Bearer ${await staff(['support'])}`);
    expect(support.status).toBe(403);
  });
});
