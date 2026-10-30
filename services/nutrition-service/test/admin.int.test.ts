import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, type Harness } from './harness';

let h: Harness;
const http = () => request(h.app.getHttpServer());
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

beforeAll(async () => {
  h = await bootApp('nutrition_admin', 10);
  for (const role of ['content_editor', 'nutrition_reviewer', 'content_reviewer', 'owner']) {
    ids[role] = randomUUID();
    tokens[role] = await h.dev.mintAccessToken({
      sub: ids[role],
      groups: [role],
      amr: ['pwd', 'mfa'],
    });
  }
  tokens.user = await h.dev.mintAccessToken({ sub: randomUUID() });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

const as = (role: string) => ({
  get: (path: string) => http().get(path).set('authorization', `Bearer ${tokens[role]}`),
  post: (path: string, body?: object) =>
    http()
      .post(path)
      .set('authorization', `Bearer ${tokens[role]}`)
      .send(body ?? {}),
  patch: (path: string, body: object) =>
    http().patch(path).set('authorization', `Bearer ${tokens[role]}`).send(body),
});

const food = (over: Record<string, unknown> = {}) => ({
  name: 'Bajra (pearl millet), whole',
  localNames: ['bajri', 'kambu'],
  source: 'CURATED_INGREDIENT',
  confidence: 'MEDIUM',
  state: 'RAW',
  category: 'millet',
  nutrients: { energyKcal: 348, proteinG: 11, carbsG: 61.8, fatG: 5.4, fibreG: 11.5 },
  units: [{ code: 'cup', label: 'Cup', grams: 170 }],
  ...over,
});

const outbox = (type: string, entityId: string) =>
  h.prisma.outboxEvent.findMany({
    where: {
      type,
      payload: {
        path: ['data', type === 'AuditEvent' ? 'entityId' : 'id'],
        equals: entityId,
      },
    },
    orderBy: { createdAt: 'asc' },
  });

describe('/v1/admin/foods', () => {
  let id: string;

  it('lets an editor draft and submit, but not publish', async () => {
    const created = await as('content_editor').post('/v1/admin/foods', food()).expect(201);
    id = created.body.id;
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      version: 1,
      dietTags: expect.arrayContaining(['VEGAN']),
    });
    await as('content_editor')
      .patch(`/v1/admin/foods/${id}`, { localNames: ['bajri', 'kambu', 'sajje'] })
      .expect(200);
    await as('content_editor').post(`/v1/admin/foods/${id}/publish`).expect(403);
    const submitted = await as('content_editor').post(`/v1/admin/foods/${id}/submit`).expect(200);
    expect(submitted.body.status).toBe('IN_REVIEW');
    await as('content_editor').patch(`/v1/admin/foods/${id}`, { name: 'Locked' }).expect(409);
  });

  it('keeps unpublished foods out of user search', async () => {
    const res = await as('user').get('/v1/foods?q=bajri').expect(200);
    expect(res.body.items).toEqual([]);
  });

  it('lets a nutrition reviewer publish, with ContentPublished and audit events', async () => {
    await as('content_reviewer').post(`/v1/admin/foods/${id}/publish`).expect(403);
    const published = await as('nutrition_reviewer')
      .post(`/v1/admin/foods/${id}/publish`)
      .expect(200);
    expect(published.body).toMatchObject({ status: 'PUBLISHED', version: 1, reviewRequired: null });
    const events = await outbox('ContentPublished', id);
    expect(events.map((e) => e.payload)).toEqual([
      expect.objectContaining({
        data: { kind: 'food', id, version: 1 },
      }),
    ]);
    const audits = (await outbox('AuditEvent', id)).map(
      (e) => (e.payload as { data: Record<string, unknown> }).data,
    );
    expect(audits.map((a) => a.action)).toEqual([
      'food.create',
      'food.update',
      'food.submit',
      'food.publish',
    ]);
    expect(audits[3]).toMatchObject({
      actorId: ids.nutrition_reviewer,
      actorRole: 'nutrition_reviewer',
      before: { status: 'IN_REVIEW' },
      after: { status: 'PUBLISHED' },
    });
    const search = await as('user').get('/v1/foods?q=sajje').expect(200);
    expect(search.body.items.map((i: { id: string }) => i.id)).toEqual([id]);
  });

  it('holds edits to a published food as a revision until it is published', async () => {
    const edited = await as('content_editor')
      .patch(`/v1/admin/foods/${id}`, {
        nutrients: { energyKcal: 361, proteinG: 11.6, carbsG: 61.8, fatG: 5.4, fibreG: 11.5 },
      })
      .expect(200);
    expect(edited.body).toMatchObject({ status: 'PUBLISHED', revisionStatus: 'DRAFT' });
    expect(edited.body.nutrients.energyKcal).toBe(348);
    await as('content_editor').post(`/v1/admin/foods/${id}/submit`).expect(200);
    const rejected = await as('nutrition_reviewer')
      .post(`/v1/admin/foods/${id}/reject`, { note: 'Use the IFCT value' })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'PUBLISHED', revisionStatus: 'DRAFT' });
    await as('content_editor').post(`/v1/admin/foods/${id}/submit`).expect(200);
    const republished = await as('nutrition_reviewer')
      .post(`/v1/admin/foods/${id}/publish`)
      .expect(200);
    expect(republished.body).toMatchObject({
      version: 2,
      revisionStatus: null,
      pendingRevision: null,
    });
    expect(republished.body.nutrients.energyKcal).toBe(361);
  });

  it('rejects publishing a food whose energy is more than 15% off its macros', async () => {
    const created = await as('owner')
      .post(
        '/v1/admin/foods',
        food({
          name: 'Bad sample',
          nutrients: { energyKcal: 150, proteinG: 11, carbsG: 61.8, fatG: 5.4, fibreG: 11.5 },
        }),
      )
      .expect(201);
    await as('owner').post(`/v1/admin/foods/${created.body.id}/submit`).expect(200);
    const res = await as('owner').post(`/v1/admin/foods/${created.body.id}/publish`).expect(422);
    expect(res.body).toMatchObject({ code: 'ENERGY_MISMATCH' });
    expect(res.body.title ?? res.body.detail).toMatch(/15%/);
  });

  it('needs a source reference for reference data', async () => {
    const created = await as('owner')
      .post('/v1/admin/foods', food({ name: 'From FDC', source: 'USDA_FDC' }))
      .expect(201);
    await as('owner').post(`/v1/admin/foods/${created.body.id}/submit`).expect(200);
    const res = await as('owner').post(`/v1/admin/foods/${created.body.id}/publish`).expect(422);
    expect(res.body.code).toBe('PUBLISH_VALIDATION_FAILED');
  });

  it('lets anyone with a food permission read, and nobody else', async () => {
    await as('content_editor').get(`/v1/admin/foods/${id}`).expect(200);
    await as('nutrition_reviewer').get('/v1/admin/foods?status=PUBLISHED').expect(200);
    await as('content_reviewer').get('/v1/admin/foods').expect(403);
    await as('user').get('/v1/admin/foods').expect(403);
  });

  it('archives, which hides the food from users', async () => {
    await as('content_editor').post(`/v1/admin/foods/${id}/archive`).expect(403);
    await as('nutrition_reviewer').post(`/v1/admin/foods/${id}/archive`).expect(200);
    const search = await as('user').get('/v1/foods?q=sajje').expect(200);
    expect(search.body.items).toEqual([]);
    await as('nutrition_reviewer').post(`/v1/admin/foods/${id}/archive`).expect(409);
  });
});

describe('/v1/admin/recipes', () => {
  const foodIds: Record<string, string> = {};

  beforeAll(async () => {
    const make = async (name: string, over: Record<string, unknown>) => {
      const res = await as('owner')
        .post('/v1/admin/foods', food({ name, ...over }))
        .expect(201);
      foodIds[name] = res.body.id;
      return res.body.id as string;
    };
    await make('Moong dal (split)', {
      nutrients: { energyKcal: 348, proteinG: 24.5, carbsG: 51.5, fatG: 1.2, fibreG: 8.2 },
      units: [],
    });
    await make('Ghee', {
      flags: ['DAIRY'],
      allergens: ['milk'],
      category: 'fat',
      nutrients: { energyKcal: 900, proteinG: 0, carbsG: 0, fatG: 99.8, fibreG: 0 },
      units: [],
    });
    await make('Cumin seeds', {
      nutrients: { energyKcal: 375, proteinG: 17.8, carbsG: 33.7, fatG: 22.3, fibreG: 10.5 },
      units: [],
    });
    for (const name of ['Moong dal (split)', 'Ghee']) {
      await as('owner').post(`/v1/admin/foods/${foodIds[name]}/submit`).expect(200);
      await as('owner').post(`/v1/admin/foods/${foodIds[name]}/publish`).expect(200);
    }
  });

  const recipe = () => ({
    slug: 'test-moong-dal-tadka',
    name: 'Test moong dal tadka',
    localNames: ['dal tadka'],
    cuisine: 'north_indian',
    region: 'north',
    mealSlots: ['LUNCH', 'DINNER'],
    servings: 4,
    cookedYieldG: 900,
    prepMinutes: 5,
    cookMinutes: 25,
    costTier: 1,
    steps: ['Cook the dal.', 'Temper cumin in ghee and pour over.'],
    ingredients: [
      { foodId: foodIds['Moong dal (split)'], grams: 150 },
      { foodId: foodIds.Ghee, grams: 15 },
      { foodId: foodIds['Cumin seeds'], grams: 2 },
    ],
    units: [{ code: 'katori', label: 'Katori', grams: 150 }],
  });

  it('rejects unknown ingredients', async () => {
    const body = {
      ...recipe(),
      slug: 'bad-recipe',
      ingredients: [{ foodId: randomUUID(), grams: 10 }],
    };
    const res = await as('content_editor').post('/v1/admin/recipes', body).expect(422);
    expect(res.body.code).toBe('UNKNOWN_INGREDIENT');
  });

  it('refuses to publish until every ingredient is published, then builds the dish', async () => {
    const created = await as('content_editor').post('/v1/admin/recipes', recipe()).expect(201);
    const id = created.body.id as string;
    await as('content_editor').post(`/v1/admin/recipes/${id}/submit`).expect(200);
    await as('nutrition_reviewer').post(`/v1/admin/recipes/${id}/publish`).expect(422);

    await as('owner').post(`/v1/admin/foods/${foodIds['Cumin seeds']}/submit`).expect(200);
    await as('owner').post(`/v1/admin/foods/${foodIds['Cumin seeds']}/publish`).expect(200);
    const published = await as('nutrition_reviewer')
      .post(`/v1/admin/recipes/${id}/publish`)
      .expect(200);
    expect(published.body).toMatchObject({
      status: 'PUBLISHED',
      allergens: ['milk'],
      oilG: 0,
      fastingOk: false,
    });
    expect(published.body.dietTags).toEqual(expect.arrayContaining(['VEGETARIAN', 'JAIN']));
    expect(published.body.dietTags).not.toContain('VEGAN');

    const dish = await as('user').get(`/v1/foods/${published.body.foodId}`).expect(200);
    expect(dish.body).toMatchObject({
      source: 'CURATED_RECIPE',
      state: 'COOKED',
      recipeSlug: 'test-moong-dal-tadka',
    });
    // (150 × 348 + 15 × 900 + 2 × 375) / 900 g × 100
    expect(dish.body.nutrients.energyKcal).toBeCloseTo(73.83, 1);

    await as('owner')
      .patch(`/v1/admin/foods/${published.body.foodId}`, { name: 'Edited dish' })
      .expect(409);

    const events = await h.prisma.outboxEvent.findMany({ where: { type: 'ContentPublished' } });
    const types = events.map((e) => (e.payload as { data: { kind: string; id: string } }).data);
    expect(types).toEqual(
      expect.arrayContaining([
        { kind: 'recipe', id, version: 1 },
        expect.objectContaining({ kind: 'food', id: published.body.foodId }),
      ]),
    );
  });

  it('needs recipe permissions', async () => {
    await as('content_reviewer').get('/v1/admin/recipes').expect(403);
    await as('content_reviewer').post('/v1/admin/recipes', recipe()).expect(403);
    await as('content_editor').get('/v1/admin/recipes?status=PUBLISHED').expect(200);
  });
});
