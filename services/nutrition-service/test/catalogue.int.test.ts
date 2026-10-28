import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { mintServiceToken, REDIS } from '@aura/service-kit';
import type { Redis } from 'ioredis';
import { TEST_INTERNAL_SECRET } from '@aura/testing';
import type { FoodSearchResponse } from '@aura/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runImport } from '../src/import/run-import';
import { DataQaJob } from '../src/qa/data-qa.job';
import { bootApp, publishAll, type Harness } from './harness';

let h: Harness;
const http = () => request(h.app.getHttpServer());

beforeAll(async () => {
  h = await bootApp('nutrition_catalogue', 9);
}, 120_000);

afterAll(async () => {
  await h?.close();
});

async function userToken(profile?: { dietType: string; allergens: string[]; cuisines?: string[] }) {
  const sub = randomUUID();
  if (profile) {
    await h.prisma.userNutritionProfile.create({
      data: {
        userId: sub,
        sex: 'FEMALE',
        birthYear: 1994,
        heightCm: 160,
        activityLevel: 'LIGHT',
        dietType: profile.dietType as never,
        allergens: profile.allergens,
        cuisines: profile.cuisines ?? [],
        dislikedFoodIds: [],
        fastingDays: [],
        goalType: 'FAT_LOSS',
        timezone: 'Asia/Kolkata',
        sourceEventId: randomUUID(),
      },
    });
  }
  return { sub, token: await h.dev.mintAccessToken({ sub }) };
}

const search = async (token: string, q: string, extra = '') =>
  (
    await http()
      .get(`/v1/foods?q=${encodeURIComponent(q)}${extra}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200)
  ).body as FoodSearchResponse;

describe('importers', () => {
  it('dry-run prints the diff and writes nothing', async () => {
    const outcome = await runImport(h.prisma, { source: 'curated', dryRun: true });
    expect(outcome.plan.counts.create).toBeGreaterThan(700);
    expect(outcome.report).toContain('Dry run (nothing written)');
    expect(outcome.report).toMatch(/\+ recipe idli Idli/);
    expect(await h.prisma.foodItem.count()).toBe(0);
  });

  it('imports curated content for review, and a second run changes nothing', async () => {
    const first = await runImport(h.prisma, { source: 'curated', dryRun: false });
    expect(first.plan.counts.update + first.plan.counts.unchanged).toBe(0);
    const idli = await h.prisma.recipe.findUniqueOrThrow({
      where: { slug: 'idli' },
      include: { food: { include: { nutrients: true } }, ingredients: true },
    });
    expect(idli).toMatchObject({ status: 'IN_REVIEW', reviewRequired: 'nutrition', region: 'south' });
    expect(idli.dietTags).toContain('VEGAN');
    expect(idli.food).toMatchObject({ source: 'CURATED_RECIPE', state: 'COOKED', status: 'IN_REVIEW' });
    expect(idli.food!.nutrients.length).toBeGreaterThanOrEqual(5);
    const cooked = await h.prisma.foodItem.findUniqueOrThrow({
      where: { slug: 'rice-white-cooked' },
      include: { rawEquivalent: true },
    });
    expect(cooked.rawEquivalent?.slug).toBe('rice-white');

    const second = await runImport(h.prisma, { source: 'curated', dryRun: false });
    expect(second.plan.counts).toMatchObject({ create: 0, update: 0, revise: 0 });
  });

  it('turns changes to published curated content into a revision for review', async () => {
    await publishAll(h.prisma);
    const ghee = await h.prisma.foodItem.findUniqueOrThrow({ where: { slug: 'ghee' } });
    await h.prisma.foodItem.update({ where: { id: ghee.id }, data: { name: 'Ghee (edited)' } });
    const plan = await runImport(h.prisma, { source: 'curated', dryRun: false });
    expect(plan.plan.changes.filter((c) => c.kind !== 'unchanged')).toEqual([
      expect.objectContaining({ kind: 'revise', key: 'CURATED_INGREDIENT:ghee', fields: ['name'] }),
    ]);
    const after = await h.prisma.foodItem.findUniqueOrThrow({ where: { id: ghee.id } });
    expect(after).toMatchObject({ name: 'Ghee (edited)', revisionStatus: 'IN_REVIEW' });
    expect(after.pendingRevision).toEqual({ name: expect.stringMatching(/ghee/i) });
    const again = await runImport(h.prisma, { source: 'curated', dryRun: false });
    expect(again.plan.counts.revise).toBe(0);
  });

  it('imports the FDC fixture idempotently', async () => {
    const dir = resolve(__dirname, 'fixtures/fdc');
    const dry = await runImport(h.prisma, { source: 'fdc', path: dir, dryRun: true });
    expect(dry.plan.counts.create).toBe(5);
    expect(dry.report).toContain('1 rows skipped');
    await runImport(h.prisma, { source: 'fdc', path: dir, dryRun: false });
    const again = await runImport(h.prisma, { source: 'fdc', path: dir, dryRun: false });
    expect(again.plan.counts).toEqual({ create: 0, update: 0, revise: 0, unchanged: 5 });
    const egg = await h.prisma.foodItem.findUniqueOrThrow({
      where: { source_sourceRef: { source: 'USDA_FDC', sourceRef: '171287' } },
    });
    expect(egg).toMatchObject({ status: 'PUBLISHED', confidence: 'HIGH', flags: ['EGG'] });
  });

  it('imports the IFCT fixture', async () => {
    const file = resolve(__dirname, 'fixtures/ifct.csv');
    const outcome = await runImport(h.prisma, { source: 'ifct', path: file, dryRun: false });
    expect(outcome.plan.counts.create).toBe(4);
    const again = await runImport(h.prisma, { source: 'ifct', path: file, dryRun: true });
    expect(again.plan.counts.unchanged).toBe(4);
  });
});

describe('GET /v1/foods', () => {
  let anyone: string;
  beforeAll(async () => {
    await publishAll(h.prisma);
    anyone = (await userToken()).token;
  });

  it.each([
    ['dal', /dal/i],
    ['roti', /^roti\b/i],
    ['paneer tikka', /^paneer tikka$/i],
    ['idli', /^idli$/i],
  ])('puts relevant curated foods first for "%s"', async (q, expected) => {
    const { items } = await search(anyone, q);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]!.name).toMatch(expected);
    expect(items[0]!.source).toMatch(/^CURATED_/);
    expect(items[0]!.per100g.energyKcal).toBeGreaterThan(0);
  });

  it('finds dishes by local name and through typos', async () => {
    expect((await search(anyone, 'arhar')).items.map((i) => i.name).join()).toMatch(/toor/i);
    expect((await search(anyone, 'panner tikka')).items[0]!.name).toMatch(/paneer tikka/i);
  });

  it('pages with a cursor', async () => {
    const first = await search(anyone, 'dal', '&limit=5');
    expect(first.items).toHaveLength(5);
    const second = await search(anyone, 'dal', `&limit=5&cursor=${first.nextCursor}`);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });

  it('never shows a vegetarian with a peanut allergy excluded foods unless they ask', async () => {
    const { token } = await userToken({ dietType: 'VEGETARIAN', allergens: ['peanut'] });
    for (const q of ['chicken', 'egg', 'fish', 'peanut', 'poha', 'mutton', 'chikki']) {
      const { items } = await search(token, q, '&limit=50');
      for (const item of items) {
        expect(item.warnings, `${q}: ${item.name}`).toEqual([]);
        expect(item.allergens, `${q}: ${item.name}`).not.toContain('peanut');
        expect(item.dietTags, `${q}: ${item.name}`).toContain('VEGETARIAN');
      }
    }
    const all = await search(token, 'chicken', '&showAll=true');
    expect(all.items.length).toBeGreaterThan(0);
    expect(all.items[0]!.warnings).toContain('DIET');
    const chikki = await search(token, 'chikki', '&showAll=true');
    expect(chikki.items.find((i) => /chikki/i.test(i.name))!.warnings).toEqual(['ALLERGEN']);
  });

  it('keeps Jain users away from onion and garlic', async () => {
    const { token } = await userToken({ dietType: 'JAIN', allergens: [] });
    const { items } = await search(token, 'dal tadka');
    expect(items.every((i) => i.dietTags.includes('JAIN'))).toBe(true);
  });

  it('shows food details to users and hides unpublished foods', async () => {
    const { items } = await search(anyone, 'idli');
    const detail = await http()
      .get(`/v1/foods/${items[0]!.id}`)
      .set('authorization', `Bearer ${anyone}`)
      .expect(200);
    expect(detail.body).toMatchObject({ recipeSlug: 'idli', state: 'COOKED' });
    expect(detail.body.units.length).toBeGreaterThan(0);
    const draft = await h.prisma.foodItem.create({
      data: { name: 'Hidden', source: 'CURATED_INGREDIENT', confidence: 'LOW', state: 'RAW', status: 'DRAFT' },
    });
    await http().get(`/v1/foods/${draft.id}`).set('authorization', `Bearer ${anyone}`).expect(404);
  });

  it('meets p95 < 150 ms on the seeded catalogue, uncached', async () => {
    const queries = [
      'dal', 'roti', 'paneer tikka', 'idli', 'dosa', 'rice', 'chicken', 'poha', 'chai', 'sambar',
      'rajma', 'chole', 'upma', 'egg', 'paratha', 'biryani', 'curd', 'banana', 'khichdi', 'aloo',
      'masala', 'paneer', 'fish', 'oats', 'ladoo', 'kheer', 'pulao', 'sabzi', 'chutney', 'vada',
    ];
    const timings: number[] = [];
    for (let round = 0; round < 3; round++) {
      await h.app.get<Redis>(REDIS).flushdb();
      for (const q of queries) {
        const started = performance.now();
        await search(anyone, `${q}${' '.repeat(round)}`);
        timings.push(performance.now() - started);
      }
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.floor(timings.length * 0.95)]!;
    expect(p95).toBeLessThan(150);
  });
});

describe('POST /internal/v1/foods/search', () => {
  it('answers coach-service with the stated diet applied', async () => {
    const token = await mintServiceToken({
      secret: TEST_INTERNAL_SECRET,
      issuer: 'coach-service',
      audience: 'nutrition-service',
    });
    const res = await http()
      .post('/internal/v1/foods/search')
      .set('x-internal-token', token)
      .send({ q: 'biryani', dietType: 'VEGETARIAN' })
      .expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i: { dietTags: string[] }) => i.dietTags.includes('VEGETARIAN'))).toBe(true);
  });
});

describe('nightly data QA', () => {
  it('flags foods whose energy is more than 15% off their macros, and clears fixed ones', async () => {
    const ghee = await h.prisma.foodItem.findUniqueOrThrow({ where: { slug: 'ghee' } });
    await h.prisma.foodNutrient.update({
      where: { foodId_nutrientCode: { foodId: ghee.id, nutrientCode: 'energy_kcal' } },
      data: { per100: 500 },
    });
    const job = new DataQaJob(h.prisma, h.app.get<Redis>(REDIS));
    const result = await job.run();
    expect(result.flagged).toBeGreaterThanOrEqual(1);
    const flagged = await h.prisma.foodItem.findMany({ where: { qaFlags: { has: 'ENERGY_MISMATCH' } } });
    expect(flagged.map((f) => f.slug)).toContain('ghee');
    expect(flagged.filter((f) => f.source.startsWith('CURATED'))).toHaveLength(1);

    await h.prisma.foodNutrient.update({
      where: { foodId_nutrientCode: { foodId: ghee.id, nutrientCode: 'energy_kcal' } },
      data: { per100: 900 },
    });
    await job.run();
    const fixed = await h.prisma.foodItem.findUniqueOrThrow({ where: { id: ghee.id } });
    expect(fixed.qaFlags).toEqual([]);
    expect(fixed.qaCheckedAt).not.toBeNull();
  });
});
