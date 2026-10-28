import { describe, expect, it } from 'vitest';
import { curatedRecords, loadCuratedContent } from '../src/catalogue/content';
import { energyCheck } from '../src/catalogue/nutrients';

const content = loadCuratedContent();
const records = curatedRecords(content);

describe('curated nutrition content', () => {
  it('parses with Zod and every reference resolves', () => {
    expect(content.ingredients.length).toBeGreaterThanOrEqual(150);
    expect(content.recipes.length).toBeGreaterThanOrEqual(290);
  });

  it('covers every region and the diets users pick', () => {
    const regions = new Set(content.recipes.map((r) => r.region));
    expect([...regions].sort()).toEqual(['east', 'north', 'northeast', 'pan_indian', 'south', 'west']);
    const diets = (d: string) =>
      [...records.composites.values()].filter((c) => c.composite.dietTags.includes(d as never))
        .length;
    expect(diets('VEGETARIAN')).toBeGreaterThan(150);
    expect(diets('VEGAN')).toBeGreaterThan(40);
    expect(diets('JAIN')).toBeGreaterThan(20);
    expect(300 - diets('VEGETARIAN')).toBeGreaterThan(40);
    const fasting = [...records.composites.values()].filter((c) => c.composite.fastingOk);
    expect(fasting.length).toBeGreaterThanOrEqual(8);
  });

  it('every ingredient and cooked form states energy within ±15% of its macros', () => {
    const bad = records.foods
      .map((f) => ({ slug: f.slug, ...energyCheck(f.nutrients) }))
      .filter((c) => !c.ok);
    expect(bad).toEqual([]);
  });

  it('every recipe composite is within ±15% (publish would reject it otherwise)', () => {
    const bad = [...records.composites.entries()]
      .map(([slug, c]) => ({ slug, ...energyCheck(c.food.nutrients) }))
      .filter((c) => !c.ok);
    expect(bad).toEqual([]);
  });

  it('every recipe has explicit oil, yield, steps and a household unit, and imports for review', () => {
    for (const r of records.recipes) {
      expect(r.cookedYieldG, r.slug).toBeGreaterThan(0);
      expect(r.steps.length, r.slug).toBeGreaterThan(0);
      expect(r.units.length, r.slug).toBeGreaterThan(0);
      expect(r.reviewRequired).toBe('nutrition');
    }
    const oily = [...records.composites.values()].filter((c) => c.composite.oilG > 0);
    expect(oily.length).toBeGreaterThan(200);
  });

  it('derives allergens from ingredients', () => {
    const kadai = records.composites.get('kadai-paneer')!.composite;
    expect(kadai.allergens).toContain('milk');
    expect(records.composites.get('chicken-biryani')!.composite.dietTags).not.toContain('VEGETARIAN');
    expect(records.composites.get('idli')!.composite.dietTags).toContain('VEGAN');
  });

  it('has plausible energy densities for dishes', () => {
    for (const [slug, c] of records.composites) {
      const kcal = c.food.nutrients.energyKcal!;
      expect(kcal, slug).toBeGreaterThan(10);
      expect(kcal, slug).toBeLessThan(600);
    }
  });
});
