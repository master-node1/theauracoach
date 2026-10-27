import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { catalogueDefaults } from '@aura/contracts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AppConfigFlagSource,
  baseEnvSchema,
  ConfigError,
  createFeatureFlags,
  FeatureFlagGuard,
  FeatureFlags,
  FileFlagSource,
  FlagsReadOnlyError,
  PollingFeatureFlags,
  ProblemDetailsFilter,
  RequireFlag,
  StaticFeatureFlags,
  type AppConfigDataApi,
} from '../src';

const baseEnv = {
  SERVICE_NAME: 'coach-service',
  PORT: '3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_JWKS_URL: 'http://localhost:4100/.well-known/jwks.json',
  AUTH_ISSUER: 'http://localhost:4100',
  AUTH_CLIENT_IDS: 'aura-dev-client',
  INTERNAL_TOKEN_SECRET: 'x'.repeat(40),
};

let dir: string;
const started: PollingFeatureFlags[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aura-flags-'));
});

afterEach(() => {
  for (const f of started.splice(0)) f.onModuleDestroy();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('file flags', () => {
  it('picks up a change to the file within the poll interval, without a restart', async () => {
    const path = join(dir, 'poll.json');
    await writeFile(path, JSON.stringify({ flags: { coach_enabled: { enabled: true } } }));
    const flags = new PollingFeatureFlags(new FileFlagSource(path), catalogueDefaults(), 50);
    started.push(flags);
    await flags.start();
    expect(flags.isEnabled('coach_enabled')).toBe(true);

    await writeFile(path, JSON.stringify({ flags: { coach_enabled: { enabled: false } } }));
    await sleep(150);
    expect(flags.isEnabled('coach_enabled')).toBe(false);
  });

  it('keeps the last good document when the file turns invalid, and treats a missing file as empty', async () => {
    const path = join(dir, 'bad.json');
    await writeFile(path, JSON.stringify({ flags: { coach_v1: { enabled: false } } }));
    const flags = new PollingFeatureFlags(new FileFlagSource(path), catalogueDefaults(), 1000);
    await flags.refresh();
    await writeFile(path, '{ not json');
    await flags.refresh();
    expect(flags.isEnabled('coach_v1')).toBe(false);
    await writeFile(path, JSON.stringify({ flags: { coach_vone: { enabled: false } } }));
    await flags.refresh();
    expect(flags.isEnabled('coach_v1')).toBe(false);

    expect(await new FileFlagSource(join(dir, 'missing.json')).load()).toEqual({ flags: {} });
  });

  it('writes rules back to the file', async () => {
    const path = join(dir, 'write.json');
    const flags = new PollingFeatureFlags(new FileFlagSource(path), catalogueDefaults(), 1000);
    await flags.start();
    started.push(flags);
    expect(flags.writable).toBe(true);
    await flags.setRule('meal_plans_v1', { enabled: true, rolloutPercent: 10 });
    await flags.setRule('barcode_v1', { enabled: false });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      flags: {
        meal_plans_v1: { enabled: true, rolloutPercent: 10 },
        barcode_v1: { enabled: false },
      },
    });
    expect(flags.isEnabled('barcode_v1')).toBe(false);
    await flags.setRule('barcode_v1', null);
    expect(flags.isEnabled('barcode_v1')).toBe(true);
  });

  it('uses FEATURE_<KEY> env values as defaults under the document', async () => {
    const path = join(dir, 'env.json');
    await writeFile(path, JSON.stringify({ flags: { coach_v1: { enabled: true } } }));
    const config = baseEnvSchema.parse({ ...baseEnv, FLAGS_SOURCE: 'file', FLAGS_FILE: path });
    const flags = await createFeatureFlags(config, {
      FEATURE_SETTINGS_V1: 'false',
      FEATURE_COACH_V1: 'false',
    });
    started.push(flags);
    expect(flags.isEnabled('settings_v1')).toBe(false);
    expect(flags.isEnabled('coach_v1')).toBe(true);
  });
});

describe('AppConfig flags', () => {
  function fakeAppConfig(versions: (object | null)[]) {
    const calls: string[] = [];
    let n = 0;
    const api: AppConfigDataApi = {
      async startSession(input) {
        calls.push(`start:${input.application}/${input.environment}/${input.profile}`);
        return 'token-0';
      },
      async latest(token) {
        calls.push(`latest:${token}`);
        const v = versions[n++];
        if (v === undefined) throw new Error('throttled');
        return {
          ...(v ? { configuration: new TextEncoder().encode(JSON.stringify(v)) } : {}),
          nextToken: `token-${n}`,
        };
      },
    };
    return { api, calls };
  }

  it('follows the session tokens and keeps the document when nothing changed', async () => {
    const { api, calls } = fakeAppConfig([{ flags: { coach_enabled: { enabled: false } } }, null]);
    const source = new AppConfigFlagSource(
      api,
      { application: 'auracoach', environment: 'prod', profile: 'flags' },
      45,
    );
    const flags = new PollingFeatureFlags(source, catalogueDefaults(), 60_000);
    await flags.refresh();
    expect(flags.isEnabled('coach_enabled')).toBe(false);
    await flags.refresh();
    expect(flags.isEnabled('coach_enabled')).toBe(false);
    // The third call fails; the session starts again on the next poll.
    await flags.refresh();
    expect(flags.isEnabled('coach_enabled')).toBe(false);
    await flags.refresh();
    expect(calls).toEqual([
      'start:auracoach/prod/flags',
      'latest:token-0',
      'latest:token-1',
      'latest:token-2',
      'start:auracoach/prod/flags',
      'latest:token-0',
    ]);
    expect(flags.writable).toBe(false);
    await expect(flags.setRule('coach_v1', { enabled: true })).rejects.toBeInstanceOf(
      FlagsReadOnlyError,
    );
  });

  it('needs the AppConfig names in the config', async () => {
    const config = baseEnvSchema.parse({ ...baseEnv, FLAGS_SOURCE: 'appconfig' });
    await expect(createFeatureFlags(config, {})).rejects.toBeInstanceOf(ConfigError);
    const file = baseEnvSchema.parse({ ...baseEnv, FLAGS_SOURCE: 'file' });
    await expect(createFeatureFlags(file, {})).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('@RequireFlag', () => {
  @Controller()
  class FlaggedController {
    @RequireFlag('meal_plans_v1')
    @Get('meal-plans')
    plans() {
      return { ok: true };
    }

    @Get('always')
    always() {
      return { ok: true };
    }
  }

  const flags = new StaticFeatureFlags({ flags: { meal_plans_v1: { enabled: false } } });
  let app: INestApplication;

  beforeAll(async () => {
    @Module({
      controllers: [FlaggedController],
      providers: [
        { provide: FeatureFlags, useValue: flags },
        { provide: APP_GUARD, useClass: FeatureFlagGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    })
    class TestModule {}
    const ref = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = ref.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('hides the route as a 404 while the flag is off', async () => {
    const res = await request(app.getHttpServer()).get('/meal-plans').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    await request(app.getHttpServer()).get('/always').expect(200);
    await flags.setRule('meal_plans_v1', { enabled: true });
    await request(app.getHttpServer()).get('/meal-plans').expect(200);
  });
});
