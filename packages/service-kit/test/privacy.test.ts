import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  LocalObjectStorage,
  createObjectStorage,
  exportJson,
  objectStorageEnvSchema,
  planProblems,
  type UserDataPlan,
} from '../src';

describe('LocalObjectStorage', () => {
  let dir: string;
  let clock: number;
  let storage: LocalObjectStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'aura-store-'));
    clock = 1_800_000_000_000;
    storage = new LocalObjectStorage(
      dir,
      'http://gw/v1/me/export-files',
      'k'.repeat(32),
      () => clock,
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('stores and reads objects', async () => {
    await storage.put('user-private/u1/exports/r1/a.json', '{"a":1}', 'application/json');
    expect((await storage.get('user-private/u1/exports/r1/a.json')).toString()).toBe('{"a":1}');
    // Personal data: only the service's own user can read it.
    const file = await stat(join(dir, 'user-private/u1/exports/r1/a.json'));
    expect(file.mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'user-private/u1/exports/r1'))).mode & 0o777).toBe(0o700);
  });

  it('refuses keys that escape the directory', async () => {
    await expect(storage.put('../outside', 'x', 'text/plain')).rejects.toThrow('Invalid');
    await expect(storage.get('/etc/passwd')).rejects.toThrow('Invalid');
    await expect(storage.put('a//b', 'x', 'text/plain')).rejects.toThrow('Invalid');
  });

  it('deletes a prefix and nothing else', async () => {
    await storage.put('user-private/u1/exports/r1/a.json', 'a', 'application/json');
    await storage.put('user-private/u2/exports/r2/b.json', 'b', 'application/json');
    expect(await storage.deletePrefix('user-private/u1/')).toBe(1);
    await expect(storage.get('user-private/u1/exports/r1/a.json')).rejects.toThrow();
    expect((await storage.get('user-private/u2/exports/r2/b.json')).toString()).toBe('b');
    expect(await storage.deletePrefix('user-private/u1/')).toBe(0);
  });

  it('refuses broad or unterminated prefixes', async () => {
    await expect(storage.deletePrefix('user-private/')).rejects.toThrow('Refusing');
    await expect(storage.deletePrefix('user-private/u1')).rejects.toThrow('Refusing');
  });

  it('signs download links that expire and cannot be altered', async () => {
    const { url, expiresAt } = await storage.presignGet('user-private/u1/x.zip', {
      expiresInSeconds: 900,
      filename: 'export.zip',
    });
    expect(expiresAt.getTime()).toBe(clock + 900_000);
    const params = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe('/v1/me/export-files');
    expect(storage.verifyDownload(params)).toEqual({
      key: 'user-private/u1/x.zip',
      filename: 'export.zip',
    });

    const tampered = new URLSearchParams(params);
    tampered.set('key', 'user-private/u2/x.zip');
    expect(storage.verifyDownload(tampered)).toBeNull();

    clock += 901_000;
    expect(storage.verifyDownload(params)).toBeNull();
  });
});

describe('createObjectStorage', () => {
  const base = { INTERNAL_TOKEN_SECRET: 's'.repeat(32) };

  it('defaults to local storage outside production', () => {
    const config = objectStorageEnvSchema.parse({});
    expect(createObjectStorage({ ...config, ...base, NODE_ENV: 'development' })).toBeInstanceOf(
      LocalObjectStorage,
    );
  });

  it('refuses local storage in production and S3 without a bucket', () => {
    const local = objectStorageEnvSchema.parse({});
    expect(() => createObjectStorage({ ...local, ...base, NODE_ENV: 'production' })).toThrow(
      ConfigError,
    );
    const s3 = objectStorageEnvSchema.parse({ OBJECT_STORAGE: 's3' });
    expect(() => createObjectStorage({ ...s3, ...base, NODE_ENV: 'production' })).toThrow(
      'S3_BUCKET',
    );
  });
});

describe('planProblems', () => {
  const models = [
    { name: 'Session', fields: [{ name: 'id' }, { name: 'userId' }] },
    { name: 'Set', fields: [{ name: 'id' }, { name: 'sessionId' }] },
    { name: 'Exercise', fields: [{ name: 'id' }] },
    { name: 'OutboxEvent', fields: [{ name: 'id' }, { name: 'userId' }] },
    { name: 'ProcessedEvent', fields: [{ name: 'eventId' }] },
  ];
  const plan: UserDataPlan = {
    service: 'workout-service',
    tables: [
      { model: 'Set', where: (userId) => ({ session: { userId } }) },
      { model: 'Session', where: (userId) => ({ userId }) },
    ],
    notUserData: { Exercise: 'Catalogue' },
  };

  it('accepts a plan that classifies every model', () => {
    expect(planProblems(plan, models)).toEqual([]);
  });

  it('finds unclassified, unknown, duplicated and misclassified models', () => {
    const problems = planProblems(
      {
        ...plan,
        tables: [{ model: 'Ghost', where: (userId) => ({ userId }) }, ...plan.tables.slice(1)],
        notUserData: { Exercise: 'Catalogue', Session: 'oops' },
      },
      models,
    );
    expect(problems).toEqual(
      expect.arrayContaining([
        'Set is not in the user data plan',
        'Ghost is in the plan but not in the schema',
        'Session is listed twice (tables and notUserData)',
      ]),
    );
    expect(
      planProblems(
        { ...plan, tables: plan.tables.slice(0, 1), notUserData: { Exercise: 'x', Session: 'x' } },
        models,
      ),
    ).toContain('Session has userId but is listed as not user data');
  });
});

describe('exportJson', () => {
  it('writes big integers as strings', () => {
    expect(JSON.parse(exportJson({ id: 12n, at: new Date(0) }))).toEqual({
      id: '12',
      at: '1970-01-01T00:00:00.000Z',
    });
  });
});
