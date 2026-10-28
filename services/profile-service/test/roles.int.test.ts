import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { configureHttpApp, UserTokenVerifier } from '@aura/service-kit';
import {
  createDevIssuer,
  createTestDatabase,
  DEV_CLIENT_ID,
  GroupStore,
  handleGroupTarget,
  testEnv,
  type DevIssuer,
  type TestDatabase,
} from '@aura/testing';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { loadServiceConfig, type ServiceConfig } from '../src/config';
import { CognitoIdentityGroups, type IdentityGroups } from '../src/identity/identity-groups';
import { PrismaService } from '../src/prisma.service';

/** Records group changes; `failNext` makes the next call fail like an unreachable Cognito. */
class FakeIdentityGroups implements IdentityGroups {
  calls: string[] = [];
  failNext = false;
  private check() {
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error('ServiceUnavailable'), { $metadata: {} });
    }
  }
  async addUserToGroup(userId: string, group: string) {
    this.check();
    this.calls.push(`add ${userId} ${group}`);
  }
  async removeUserFromGroup(userId: string, group: string) {
    this.check();
    this.calls.push(`remove ${userId} ${group}`);
  }
}

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let prisma: PrismaService;
let config: ServiceConfig;
const identity = new FakeIdentityGroups();
const OWNER = randomUUID();

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'profile_roles');
  dev = await createDevIssuer();
  config = loadServiceConfig(
    testEnv({ service: 'profile-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 8 }),
  );
  const verifier = new UserTokenVerifier({
    jwksUrl: config.AUTH_JWKS_URL,
    issuer: dev.issuer,
    clientIds: [DEV_CLIENT_ID],
    keySource: dev.keySource,
  });
  const ref = await Test.createTestingModule({
    imports: [AppModule.register(config, verifier, undefined, identity)],
  }).compile();
  app = configureHttpApp(ref.createNestApplication());
  await app.init();
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(() => {
  identity.calls = [];
});

const ownerToken = (amr = ['pwd', 'mfa'], groups = ['owner']) =>
  dev.mintAccessToken({ sub: OWNER, email: 'owner@example.com', groups, amr });

async function createUser(email: string): Promise<string> {
  const sub = randomUUID();
  await request(app.getHttpServer())
    .get('/v1/me')
    .set('authorization', `Bearer ${await dev.mintAccessToken({ sub, email })}`)
    .expect(200);
  return sub;
}

const api = () => request(app.getHttpServer());
const auditEvents = (userId: string) =>
  prisma.outboxEvent.findMany({
    where: { userId, type: 'AuditEvent' },
    orderBy: { createdAt: 'asc' },
  });

describe('/v1/admin/roles', () => {
  it('lists the seeded roles with their permissions', async () => {
    const res = await api()
      .get('/v1/admin/roles')
      .set('authorization', `Bearer ${await ownerToken()}`)
      .expect(200);
    expect(res.body.roles.map((r: { id: string }) => r.id)).toEqual([
      'owner',
      'content_editor',
      'content_reviewer',
      'nutrition_reviewer',
      'safety_reviewer',
      'support',
    ]);
    expect(res.body.roles[2].permissions).toContain('exercise:publish');
    expect(await prisma.role.count()).toBe(6);
  });

  it('needs MFA and role:grant (TC-SEC-3)', async () => {
    const noMfa = await api()
      .get('/v1/admin/roles')
      .set('authorization', `Bearer ${await ownerToken(['pwd'])}`);
    expect(noMfa.body).toMatchObject({ status: 403, code: 'MFA_REQUIRED' });
    const editor = await api()
      .get('/v1/admin/roles')
      .set('authorization', `Bearer ${await ownerToken(['pwd', 'mfa'], ['content_editor'])}`);
    expect(editor.body).toMatchObject({ status: 403, code: 'FORBIDDEN' });
  });

  it('grants a role in the DB and the identity groups with one audit event', async () => {
    const userId = await createUser('reviewer@example.com');
    const grant = await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${await ownerToken()}`)
      .set('x-request-id', '5b0f4f1c-6d38-4e55-9a9e-6a1f8d7c2b10')
      .send({ email: 'Reviewer@example.com', role: 'content_reviewer' })
      .expect(201);
    expect(grant.body).toMatchObject({
      userId,
      email: 'reviewer@example.com',
      role: 'content_reviewer',
      grantedBy: OWNER,
    });
    expect(identity.calls).toEqual([`add ${userId} content_reviewer`]);

    // Granting again changes nothing and is not audited twice.
    await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${await ownerToken()}`)
      .send({ userId, role: 'content_reviewer' })
      .expect(200);
    expect(identity.calls).toHaveLength(1);

    const events = await auditEvents(userId);
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { data: unknown }).data).toEqual({
      actorId: OWNER,
      actorRole: 'owner',
      action: 'role.grant',
      entityType: 'user_role',
      entityId: `${userId}:content_reviewer`,
      before: null,
      after: { userId, role: 'content_reviewer' },
      requestId: '5b0f4f1c-6d38-4e55-9a9e-6a1f8d7c2b10',
    });
    const me = await api()
      .get('/v1/me')
      .set('authorization', `Bearer ${await dev.mintAccessToken({ sub: userId })}`)
      .expect(200);
    expect(me.body.roles).toEqual(['user', 'content_reviewer']);
  });

  it('revokes a role in the DB and the identity groups with one audit event', async () => {
    const userId = await createUser('support@example.com');
    await prisma.userRole.create({ data: { userId, roleId: 'support' } });
    await api()
      .delete(`/v1/admin/roles/${userId}/support`)
      .set('authorization', `Bearer ${await ownerToken()}`)
      .expect(204);
    expect(await prisma.userRole.count({ where: { userId } })).toBe(0);
    expect(identity.calls).toEqual([`remove ${userId} support`]);
    const events = await auditEvents(userId);
    expect(events.map((e) => (e.payload as { data: { action: string } }).data.action)).toEqual([
      'role.revoke',
    ]);
    await api()
      .delete(`/v1/admin/roles/${userId}/support`)
      .set('authorization', `Bearer ${await ownerToken()}`)
      .expect(404);
  });

  it('commits nothing when the identity provider fails', async () => {
    const userId = await createUser('flaky@example.com');
    identity.failNext = true;
    const res = await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${await ownerToken()}`)
      .send({ userId, role: 'support' });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('IDENTITY_UNAVAILABLE');
    expect(await prisma.userRole.count({ where: { userId } })).toBe(0);
    expect(await auditEvents(userId)).toHaveLength(0);
  });

  it('keeps at least one owner', async () => {
    const only = await createUser('first-owner@example.com');
    await prisma.userRole.deleteMany({ where: { roleId: 'owner' } });
    await prisma.userRole.create({ data: { userId: only, roleId: 'owner' } });
    const res = await api()
      .delete(`/v1/admin/roles/${only}/owner`)
      .set('authorization', `Bearer ${await ownerToken()}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LAST_OWNER');
  });

  it('rejects unknown users, the implicit user role and bad bodies', async () => {
    const token = await ownerToken();
    await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ userId: randomUUID(), role: 'support' })
      .expect(404);
    await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ email: 'x@example.com', role: 'user' })
      .expect(422);
    await api()
      .post('/v1/admin/roles')
      .set('authorization', `Bearer ${token}`)
      .send({ userId: randomUUID(), email: 'x@example.com', role: 'support' })
      .expect(422);
  });
});

describe('CognitoIdentityGroups against dev-auth', () => {
  let server: Server;
  const store = new GroupStore();

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const target = req.headers['x-amz-target'];
        const out = handleGroupTarget(
          store,
          typeof target === 'string' ? target : undefined,
          JSON.parse(raw),
        );
        res.writeHead(out?.status ?? 400, out?.headers).end(out?.body);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });

  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('adds and removes groups through the AWS SDK', async () => {
    const port = (server.address() as AddressInfo).port;
    const groups = new CognitoIdentityGroups({
      ...config,
      IDENTITY_ENDPOINT: `http://127.0.0.1:${port}/`,
    });
    const sub = randomUUID();
    await groups.addUserToGroup(sub, 'support');
    expect(store.list(sub)).toEqual(['support']);
    await groups.removeUserFromGroup(sub, 'support');
    expect(store.list(sub)).toEqual([]);
  });
});
