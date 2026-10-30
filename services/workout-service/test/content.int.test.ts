import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExerciseContentInput, TemplateContentInput } from '@aura/contracts';
import { DEFAULT_WORKOUT_POLICY } from '@aura/domain/workouts';
import { configureHttpApp, REDIS, UserTokenVerifier } from '@aura/service-kit';
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
import { contentPublishedSubscription } from '../src/content/content-published.subscription';
import { ContentStore } from '../src/content/content-store';
import { importContent, loadContentDir } from '../src/content/importer';
import { LibraryCache } from '../src/content/library-cache';
import { loadWorkoutPolicy } from '../src/content/policy';
import { PrismaService } from '../src/prisma.service';

let db: TestDatabase;
let app: INestApplication;
let dev: DevIssuer;
let prisma: PrismaService;

const EDITOR = randomUUID();
const REVIEWER = randomUUID();

beforeAll(async () => {
  db = await createTestDatabase(resolve(__dirname, '..'), 'workout_content');
  dev = await createDevIssuer();
  const config = loadServiceConfig(
    testEnv({ service: 'workout-service', databaseUrl: db.url, issuer: dev.issuer, redisDb: 9 }),
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
  await app.get<{ flushdb(): Promise<unknown> }>(REDIS).flushdb();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const token = (sub: string, groups: string[]) =>
  dev.mintAccessToken({ sub, email: `${sub}@example.com`, groups, amr: ['pwd', 'mfa'] });
const as = async (sub: string, groups: string[]) => `Bearer ${await token(sub, groups)}`;
const editor = () => as(EDITOR, ['content_editor']);
const reviewer = () => as(REVIEWER, ['content_reviewer']);
const member = () => as(randomUUID(), []);
const api = () => request(app.getHttpServer());

const exercise = (slug: string, change: Partial<ExerciseContentInput> = {}) => ({
  slug,
  name: 'Test squat',
  movementPattern: 'squat',
  mechanics: 'compound',
  difficulty: 'BEGINNER',
  primaryMuscles: ['quadriceps', 'glutes'],
  equipment: ['bodyweight'],
  instructions: ['Stand tall.', 'Squat down.', 'Stand up.'],
  contraindicationsReviewed: true,
  ...change,
});

const events = (type: string) =>
  prisma.outboxEvent.findMany({ where: { type }, orderBy: { createdAt: 'asc' } });

async function draftAndPublish(path: string, body: object) {
  const created = await api()
    .post(path)
    .set('authorization', await editor())
    .send(body)
    .expect(201);
  await api()
    .post(`${path}/${created.body.id}/submit`)
    .set('authorization', await editor())
    .expect(200);
  return api()
    .post(`${path}/${created.body.id}/publish`)
    .set('authorization', await reviewer());
}

describe('seeded policy', () => {
  it('loads the migration-seeded policy rows as the engine defaults', async () => {
    expect(await loadWorkoutPolicy(prisma)).toEqual(DEFAULT_WORKOUT_POLICY);
    expect(await prisma.workoutPolicy.count()).toBe(Object.keys(DEFAULT_WORKOUT_POLICY).length);
  });
});

describe('exercise workflow (admin LLD §2)', () => {
  let v1: string;
  let v2: string;

  it('lets editors draft and submit, and only reviewers publish', async () => {
    await api()
      .post('/v1/admin/exercises')
      .set('authorization', await member())
      .send(exercise('wf-squat'))
      .expect(403);
    await api()
      .post('/v1/admin/exercises')
      .set('authorization', await reviewer())
      .send(exercise('wf-squat'))
      .expect(403);
    const created = await api()
      .post('/v1/admin/exercises')
      .set('authorization', await editor())
      .send(exercise('wf-squat'))
      .expect(201);
    v1 = created.body.id;
    expect(created.body).toMatchObject({
      slug: 'wf-squat',
      version: 1,
      status: 'DRAFT',
      live: false,
    });
    expect(created.body.body).toMatchObject({ tracking: 'reps', media: [], regression: null });

    await api()
      .post(`/v1/admin/exercises/${v1}/publish`)
      .set('authorization', await reviewer())
      .expect(409);
    await api()
      .post(`/v1/admin/exercises/${v1}/submit`)
      .set('authorization', await reviewer())
      .expect(403);
    await api()
      .post(`/v1/admin/exercises/${v1}/submit`)
      .set('authorization', await editor())
      .expect(200);
    await api()
      .post(`/v1/admin/exercises/${v1}/publish`)
      .set('authorization', await editor())
      .expect(403);
    const published = await api()
      .post(`/v1/admin/exercises/${v1}/publish`)
      .set('authorization', await reviewer())
      .expect(200);
    expect(published.body).toMatchObject({ status: 'PUBLISHED', live: true, version: 1 });

    const row = await prisma.exercise.findUniqueOrThrow({
      where: { slug: 'wf-squat' },
      include: { muscles: true, equipment: true },
    });
    expect(row).toMatchObject({ status: 'PUBLISHED', version: 1, isBodyweight: true });
    expect(row.muscles.map((m) => `${m.muscleCode}:${m.role}`).sort()).toEqual([
      'glutes:primary',
      'quadriceps:primary',
    ]);
  });

  it('refuses a second draft with the same slug', async () => {
    const res = await api()
      .post('/v1/admin/exercises')
      .set('authorization', await editor())
      .send(exercise('wf-squat'));
    expect(res.body).toMatchObject({ status: 409, code: 'SLUG_TAKEN' });
  });

  it('never edits a published version: an edit opens version 2', async () => {
    const edit = await api()
      .put(`/v1/admin/exercises/${v1}`)
      .set('authorization', await editor())
      .send(exercise('wf-squat', { name: 'Test squat, renamed' }))
      .expect(201);
    v2 = edit.body.id;
    expect(edit.body).toMatchObject({ version: 2, status: 'DRAFT', live: false });
    const first = await api()
      .get(`/v1/admin/exercises/${v1}`)
      .set('authorization', await reviewer())
      .expect(200);
    expect(first.body).toMatchObject({
      status: 'PUBLISHED',
      live: true,
      body: { name: 'Test squat' },
    });

    const again = await api()
      .put(`/v1/admin/exercises/${v1}`)
      .set('authorization', await editor())
      .send(exercise('wf-squat'));
    expect(again.body).toMatchObject({ status: 409, code: 'DRAFT_EXISTS', revisionId: v2 });

    const slug = await api()
      .put(`/v1/admin/exercises/${v2}`)
      .set('authorization', await editor())
      .send(exercise('wf-other'));
    expect(slug.body).toMatchObject({ status: 422, code: 'SLUG_IMMUTABLE' });

    await api()
      .put(`/v1/admin/exercises/${v2}`)
      .set('authorization', await editor())
      .send(exercise('wf-squat', { name: 'Test squat v2' }))
      .expect(200);
  });

  it('publishes version 2 over the same library row and keeps version 1 as reviewed', async () => {
    const before = await prisma.exercise.findUniqueOrThrow({ where: { slug: 'wf-squat' } });
    await api()
      .post(`/v1/admin/exercises/${v2}/submit`)
      .set('authorization', await editor())
      .expect(200);
    await api()
      .post(`/v1/admin/exercises/${v2}/publish`)
      .set('authorization', await reviewer())
      .expect(200);
    const after = await prisma.exercise.findUniqueOrThrow({ where: { slug: 'wf-squat' } });
    expect(after).toMatchObject({ id: before.id, version: 2, name: 'Test squat v2' });
    const first = await api()
      .get(`/v1/admin/exercises/${v1}`)
      .set('authorization', await editor())
      .expect(200);
    expect(first.body).toMatchObject({
      status: 'PUBLISHED',
      live: false,
      body: { name: 'Test squat' },
    });

    const list = await api()
      .get('/v1/admin/exercises?q=wf-squat')
      .set('authorization', await reviewer())
      .expect(200);
    expect(list.body.items.map((r: { version: number }) => r.version)).toEqual([2, 1]);
  });

  it('emits ContentPublished once per publish and audits every step', async () => {
    const published = (await events('ContentPublished')).map((e) => e.payload as { data: unknown });
    const row = await prisma.exercise.findUniqueOrThrow({ where: { slug: 'wf-squat' } });
    expect(published.map((p) => p.data)).toEqual([
      { kind: 'exercise', id: row.id, version: 1 },
      { kind: 'exercise', id: row.id, version: 2 },
    ]);
    const audits = (await events('AuditEvent'))
      .map(
        (e) => (e.payload as { data: { action: string; actorId: string; actorRole: string } }).data,
      )
      .filter((a) => a.action.startsWith('exercise.'));
    expect(audits.map((a) => a.action)).toEqual([
      'exercise.create',
      'exercise.submit',
      'exercise.publish',
      'exercise.update',
      'exercise.update',
      'exercise.submit',
      'exercise.publish',
    ]);
    expect(audits[2]).toMatchObject({ actorId: REVIEWER, actorRole: 'content_reviewer' });
    expect(audits[0]).toMatchObject({ actorId: EDITOR, actorRole: 'content_editor' });
  });

  it('refuses to publish an exercise that fails the checks, naming each one', async () => {
    const created = await api()
      .post('/v1/admin/exercises')
      .set('authorization', await editor())
      .send(
        exercise('wf-incomplete', {
          primaryMuscles: [],
          contraindicationsReviewed: false,
          regression: 'no-such-exercise',
          media: [{ kind: 'VIDEO', storageKey: 'videos/x.mp4' }],
        }),
      )
      .expect(201);
    await api()
      .post(`/v1/admin/exercises/${created.body.id}/submit`)
      .set('authorization', await editor())
      .expect(200);
    const res = await api()
      .post(`/v1/admin/exercises/${created.body.id}/publish`)
      .set('authorization', await reviewer());
    expect(res.body).toMatchObject({ status: 422, code: 'PUBLISH_CHECKS_FAILED' });
    expect(res.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'contraindicationsReviewed',
      'media.0.altText',
      'media.0.captionsKey',
      'primaryMuscles',
      'regression',
    ]);
    expect(await prisma.exercise.findUnique({ where: { slug: 'wf-incomplete' } })).toBeNull();
  });
});

describe('template publish checks', () => {
  const template = (slug: string, exerciseSlug: string): TemplateContentInput => ({
    slug,
    name: 'Test template',
    goal: 'GENERAL_FITNESS',
    experience: 'BEGINNER',
    location: 'GYM',
    split: 'full_body',
    daysPerWeek: 3,
    days: [
      {
        name: 'Day A',
        focus: 'full body',
        exercises: [
          { exercise: exerciseSlug, sets: 3, repMin: 8, repMax: 12, targetRpe: 7, restSec: 90 },
        ],
      },
    ],
  });

  it('refuses a template naming an unpublished exercise', async () => {
    const res = await draftAndPublish(
      '/v1/admin/templates',
      template('tpl-unpublished', 'wf-incomplete'),
    );
    expect(res.body).toMatchObject({ status: 422, code: 'PUBLISH_CHECKS_FAILED' });
    expect(res.body.errors[0].path).toBe('days.0.exercises.0.exercise');
  });

  it('refuses a template when a synthetic profile gets an invalid plan (TC: 20 profiles)', async () => {
    // A knee-loading barbell squat is the whole library: the knee-injury profiles get no exercise.
    const loaded = await draftAndPublish(
      '/v1/admin/exercises',
      exercise('wf-barbell-squat', {
        equipment: ['barbell'],
        contraindications: ['knee_high_load', 'axial_load_heavy'],
      }),
    );
    expect(loaded.status).toBe(200);
    await prisma.exercise.update({ where: { slug: 'wf-squat' }, data: { status: 'ARCHIVED' } });
    try {
      const res = await draftAndPublish(
        '/v1/admin/templates',
        template('tpl-unsafe', 'wf-barbell-squat'),
      );
      expect(res.body).toMatchObject({ status: 422, code: 'PUBLISH_CHECKS_FAILED' });
      const messages = res.body.errors.map((e: { message: string }) => e.message).join('\n');
      expect(messages).toContain('SAMPLE_PLAN_INVALID');
      expect(messages).toContain('knee injury, moderate');
      expect(messages).not.toContain('"baseline"');
    } finally {
      await prisma.exercise.update({ where: { slug: 'wf-squat' }, data: { status: 'PUBLISHED' } });
    }
  });

  it('publishes a template every profile can use, and blocks archiving its exercises', async () => {
    const res = await draftAndPublish('/v1/admin/templates', template('tpl-safe', 'wf-squat'));
    expect(res.status).toBe(200);
    const row = await prisma.workoutTemplate.findUniqueOrThrow({
      where: { slug: 'tpl-safe' },
      include: { items: true },
    });
    expect(row).toMatchObject({ status: 'PUBLISHED', daysPerWeek: 3, version: 1 });
    expect(row.items).toHaveLength(1);

    const live = await api()
      .get('/v1/admin/exercises?q=wf-squat&status=PUBLISHED')
      .set('authorization', await reviewer());
    const current = live.body.items.find((r: { live: boolean }) => r.live);
    const blocked = await api()
      .post(`/v1/admin/exercises/${current.id}/archive`)
      .set('authorization', await reviewer());
    expect(blocked.body).toMatchObject({
      status: 409,
      code: 'EXERCISE_IN_USE',
      templates: 'tpl-safe',
    });

    const archived = await api()
      .post(`/v1/admin/templates/${res.body.id}/archive`)
      .set('authorization', await reviewer())
      .expect(200);
    expect(archived.body).toMatchObject({ status: 'ARCHIVED', live: false });
    await api()
      .post(`/v1/admin/exercises/${current.id}/archive`)
      .set('authorization', await reviewer())
      .expect(200);
    expect(await prisma.exercise.findUniqueOrThrow({ where: { slug: 'wf-squat' } })).toMatchObject({
      status: 'ARCHIVED',
    });
  });
});

describe('content importer', () => {
  const dir = resolve(__dirname, '../../../content/workouts');

  it('reports a dry run without writing', async () => {
    const store = new ContentStore(prisma);
    const before = await prisma.contentRevision.count();
    const report = await importContent(store, await loadContentDir(dir), { dryRun: true });
    expect(report.changes).toHaveLength(133);
    expect(new Set(report.changes.map((c) => c.action))).toEqual(new Set(['create']));
    expect(await prisma.contentRevision.count()).toBe(before);
  });

  it('imports and publishes the starter dataset, then changes nothing on a second run', async () => {
    const store = new ContentStore(prisma);
    const entries = await loadContentDir(dir);
    const first = await importContent(store, entries, { publish: true });
    expect(first.refused).toEqual([]);
    expect(first.published).toHaveLength(133);
    expect(
      await prisma.exercise.count({
        where: { status: 'PUBLISHED', slug: { not: { startsWith: 'wf-' } } },
      }),
    ).toBe(120);
    expect(await prisma.workoutTemplate.count({ where: { status: 'PUBLISHED' } })).toBe(13);
    const goblet = await prisma.exercise.findUniqueOrThrow({
      where: { slug: 'goblet-squat' },
      include: { regression: true, progression: true },
    });
    expect(goblet.regression?.slug).toBe('bodyweight-squat');
    expect(goblet.progression?.slug).toBe('barbell-back-squat');

    const second = await importContent(store, entries, { publish: true });
    expect(new Set(second.changes.map((c) => c.action))).toEqual(new Set(['unchanged']));
    expect(second.published).toEqual([]);
  });

  it('opens a new in-review version when a published item changes in the files', async () => {
    const store = new ContentStore(prisma);
    const entries = await loadContentDir(dir);
    const plank = entries.find((e) => e.body.slug === 'plank')!;
    const changed = [{ ...plank, body: { ...plank.body, name: 'Front plank' } }];
    const report = await importContent(store, changed);
    expect(report.changes).toEqual([
      { kind: 'exercise', slug: 'plank', action: 'new_version', version: 2 },
    ]);
    const latest = (await store.latestBySlug('exercise')).get('plank')!;
    expect(latest).toMatchObject({ version: 2, status: 'IN_REVIEW', reviewRequired: 'trainer' });
    const again = await importContent(store, changed);
    expect(again.changes[0]!.action).toBe('unchanged');
  });
});

describe('exercise library API', () => {
  const get = async (path: string, headers: Record<string, string> = {}) =>
    api()
      .get(path)
      .set('authorization', await member())
      .set(headers);

  it('needs a signed-in user', async () => {
    await api().get('/v1/exercises').expect(401);
  });

  it('pages the published library with filters', async () => {
    const page = await get('/v1/exercises?limit=50');
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(50);
    const rest = await get(`/v1/exercises?limit=100&cursor=${page.body.nextCursor}`);
    expect(rest.body.nextCursor).toBeNull();
    expect(page.body.items.length + rest.body.items.length).toBe(121); // 120 + wf-barbell-squat

    const hinge = await get('/v1/exercises?pattern=hinge&equipment=dumbbell&limit=100');
    expect(hinge.body.items.length).toBeGreaterThan(0);
    for (const e of hinge.body.items) {
      expect(e.movementPattern).toBe('hinge');
      expect(e.equipment).toContain('dumbbell');
    }
    const calves = await get('/v1/exercises?muscle=calves&limit=100');
    expect(calves.body.items.map((e: { slug: string }) => e.slug)).toContain('seated-calf-raise');
    const search = await get('/v1/exercises?q=GOBLET');
    expect(search.body.items.map((e: { slug: string }) => e.slug)).toEqual([
      'goblet-squat',
      'kettlebell-goblet-squat',
    ]);
    const bad = await get('/v1/exercises?muscle=elbows');
    expect(bad.status).toBe(422);
  });

  it('shows an exercise with its links, and 404s unknown or archived ones', async () => {
    const res = await get('/v1/exercises/goblet-squat');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'goblet-squat',
      primaryMuscles: ['quadriceps', 'glutes'],
      equipment: ['dumbbell'],
      regression: { slug: 'bodyweight-squat' },
      progression: { slug: 'barbell-back-squat' },
      illustrationKey: 'placeholder/squat',
      media: [],
    });
    expect(res.body.instructions.length).toBeGreaterThan(2);
    expect((await get('/v1/exercises/nope')).body).toMatchObject({
      status: 404,
      code: 'EXERCISE_NOT_FOUND',
    });
    expect((await get('/v1/exercises/wf-squat')).status).toBe(404);
  });

  it('answers 304 to a matching ETag and changes the ETag when a new version is published', async () => {
    const first = await get('/v1/exercises/push-up');
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^".+"$/);
    expect((await get('/v1/exercises/push-up', { 'if-none-match': etag })).status).toBe(304);
    const list = await get('/v1/exercises?pattern=push_h');
    expect(
      (await get('/v1/exercises?pattern=push_h', { 'if-none-match': list.headers.etag as string }))
        .status,
    ).toBe(304);

    const current = (await new ContentStore(prisma).latestBySlug('exercise')).get('push-up')!;
    const body = { ...(current.body as object), name: 'Push-up (classic)' };
    const edit = await api()
      .put(`/v1/admin/exercises/${current.id}`)
      .set('authorization', await editor())
      .send(body)
      .expect(201);
    await api()
      .post(`/v1/admin/exercises/${edit.body.id}/submit`)
      .set('authorization', await editor())
      .expect(200);
    await api()
      .post(`/v1/admin/exercises/${edit.body.id}/publish`)
      .set('authorization', await reviewer())
      .expect(200);

    const after = await get('/v1/exercises/push-up', { 'if-none-match': etag });
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ name: 'Push-up (classic)', version: 2 });
    expect(after.headers.etag).not.toBe(etag);
    const listAfter = await get('/v1/exercises?pattern=push_h', {
      'if-none-match': list.headers.etag as string,
    });
    expect(listAfter.status).toBe(200);
  });

  it('serves from the cache until a ContentPublished event invalidates it', async () => {
    const cached = await get('/v1/exercises/plank');
    await prisma.exercise.update({
      where: { slug: 'plank' },
      data: { name: 'Changed behind the cache' },
    });
    expect((await get('/v1/exercises/plank')).body.name).toBe(cached.body.name);

    const subscription = contentPublishedSubscription(app.get(LibraryCache));
    const event = { data: { kind: 'exercise', id: cached.body.id, version: 2 } };
    await subscription.handle(event as never, prisma);
    expect((await get('/v1/exercises/plank')).body.name).toBe('Changed behind the cache');
  });
});
