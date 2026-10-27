import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DIET_EXCLUSIONS,
  generateMealPlan,
  groceryList,
  sum,
  suggestAlternatives,
  dec,
  type DietType,
  type FoodFlag,
  type MealPlanInput,
  type PlanRecipe,
} from '../../src/nutrition';
import { RECIPES } from './fixtures';

const SLOTS = ['BREAKFAST', 'LUNCH', 'SNACK', 'DINNER'] as const;
const base: MealPlanInput = {
  weekStart: '2026-11-02', // Monday
  slots: SLOTS,
  targets: { energyKcal: 2000, proteinG: 100, fibreG: 25 },
  preferences: { dietType: 'NON_VEGETARIAN', allergens: [] },
  recipes: RECIPES,
};
const byId = new Map(RECIPES.map((r) => [r.id, r]));
const flagsOf = (r: PlanRecipe) => new Set(r.ingredients.flatMap((i) => i.flags));
const allergensOf = (r: PlanRecipe) => new Set(r.ingredients.flatMap((i) => i.allergens));

describe('generateMealPlan', () => {
  it('plans 7 days within ±7% energy and ≥ 90% protein, with 0.5 serving steps', () => {
    const plan = generateMealPlan(base);
    expect(plan.days).toHaveLength(7);
    expect(plan.issues).toEqual([]);
    for (const day of plan.days) {
      expect(day.withinTargets).toBe(true);
      expect(day.items.map((i) => i.slot)).toEqual([...SLOTS]);
      const e = day.totals.energyKcal.toNumber();
      expect(Math.abs(e - 2000) / 2000).toBeLessThanOrEqual(0.07);
      expect(day.totals.proteinG.toNumber()).toBeGreaterThanOrEqual(90);
      for (const item of day.items) expect((item.servings * 2) % 1).toBe(0);
    }
  });

  it('is deterministic', () => {
    expect(generateMealPlan(base)).toEqual(generateMealPlan(base));
  });

  it('uses no recipe more than twice a week when the library allows it', () => {
    const plan = generateMealPlan(base);
    const counts = new Map<string, number>();
    for (const d of plan.days)
      for (const i of d.items) counts.set(i.recipeId, (counts.get(i.recipeId) ?? 0) + 1);
    expect(plan.relaxations).not.toContain('RELAXED_VARIETY');
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it('vegetarian plans contain no meat, fish or egg (TC-NU-10)', () => {
    const plan = generateMealPlan({
      ...base,
      preferences: { dietType: 'VEGETARIAN', allergens: [] },
    });
    for (const d of plan.days) {
      for (const i of d.items) {
        const flags = flagsOf(byId.get(i.recipeId)!);
        expect(flags.has('MEAT') || flags.has('FISH') || flags.has('EGG')).toBe(false);
      }
    }
  });

  it('Jain plans contain no onion, garlic or root vegetables (TC-NU-9)', () => {
    const plan = generateMealPlan({ ...base, preferences: { dietType: 'JAIN', allergens: [] } });
    const planned = plan.days.flatMap((d) => d.items);
    expect(planned.length).toBeGreaterThan(0);
    for (const i of planned) {
      const flags = flagsOf(byId.get(i.recipeId)!);
      for (const f of ['ONION', 'GARLIC', 'ROOT_VEGETABLE', 'MEAT', 'FISH', 'EGG'] as FoodFlag[]) {
        expect(flags.has(f)).toBe(false);
      }
    }
  });

  it('derives allergens from ingredients, not recipe tags', () => {
    // paneer-paratha carries milk only through its paneer and ghee ingredients.
    const plan = generateMealPlan({
      ...base,
      preferences: { dietType: 'VEGETARIAN', allergens: ['milk'] },
    });
    for (const d of plan.days)
      for (const i of d.items) expect(allergensOf(byId.get(i.recipeId)!).has('milk')).toBe(false);
  });

  it('uses only fasting-friendly recipes on fasting days', () => {
    const plan = generateMealPlan({
      ...base,
      fastingDates: ['2026-11-04'],
      preferences: { dietType: 'VEGETARIAN', allergens: [] },
    });
    const day = plan.days.find((d) => d.date === '2026-11-04')!;
    expect(day.fasting).toBe(true);
    for (const i of day.items) expect(flagsOf(byId.get(i.recipeId)!).has('FASTING_OK')).toBe(true);
  });

  it('limits weekday prep time and relaxes it only when it must', () => {
    const plan = generateMealPlan({
      ...base,
      preferences: { dietType: 'NON_VEGETARIAN', allergens: [], maxWeekdayPrepMinutes: 30 },
    });
    for (const d of plan.days.slice(0, 5)) {
      if (d.relaxations.includes('RELAXED_PREP_TIME')) continue;
      for (const i of d.items) expect(byId.get(i.recipeId)!.prepMinutes).toBeLessThanOrEqual(30);
    }
  });

  it('returns a partial plan with UNSATISFIABLE_SLOT when hard filters leave nothing', () => {
    // Vegan rules out the dairy snacks; disliking chana and moong rules out the rest.
    const plan = generateMealPlan({
      ...base,
      preferences: { dietType: 'VEGAN', allergens: [], dislikedFoodIds: ['chana', 'moong'] },
    });
    expect(plan.issues).toContainEqual({
      date: '2026-11-02',
      slot: 'SNACK',
      code: 'UNSATISFIABLE_SLOT',
    });
    expect(plan.issues.some((i) => i.code === 'DAY_TARGET_NOT_MET')).toBe(true);
    for (const d of plan.days) expect(d.items.some((i) => i.slot === 'SNACK')).toBe(false);
  });

  it('relaxes variety before prep time and never relaxes hard filters', () => {
    const small = RECIPES.filter((r) =>
      ['poha', 'dal-rice', 'roasted-chana', 'chicken-curry-rice', 'egg-bhurji'].includes(r.id),
    );
    const plan = generateMealPlan({ ...base, recipes: small });
    expect(plan.relaxations).toContain('RELAXED_VARIETY');
    expect(plan.relaxations).not.toContain('RELAXED_PREP_TIME');
  });
});

// ---------------------------------------------------------------------------------------------
// Property tests over random recipe sets

const ALLERGENS = ['milk', 'peanut', 'gluten', 'soy', 'egg', 'fish', 'sesame'];
const FLAGS: FoodFlag[] = [
  'MEAT',
  'FISH',
  'EGG',
  'DAIRY',
  'HONEY',
  'ROOT_VEGETABLE',
  'ONION',
  'GARLIC',
  'FASTING_OK',
];
const DIETS = Object.keys(DIET_EXCLUSIONS) as DietType[];

const ingredientArb = fc.record({
  foodId: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'),
  name: fc.constant('x'),
  gramsPerServing: fc.integer({ min: 1, max: 300 }).map((g) => g / 3),
  aisle: fc.constantFrom('grains', 'dairy', 'veg'),
  allergens: fc.subarray(ALLERGENS, { maxLength: 2 }),
  flags: fc.subarray(FLAGS, { maxLength: 3 }),
  packGrams: fc.option(fc.integer({ min: 100, max: 1000 }), { nil: undefined }),
});
const recipeArb = (id: number) =>
  fc.record({
    id: fc.constant<string>(`r${id}`),
    name: fc.constant(`r${id}`),
    slots: fc.subarray([...SLOTS], { minLength: 1 }),
    perServing: fc.record({
      energyKcal: fc.integer({ min: 80, max: 700 }),
      proteinG: fc.integer({ min: 0, max: 45 }),
      fibreG: fc.integer({ min: 0, max: 12 }),
    }),
    ingredients: fc.array(ingredientArb, { minLength: 1, maxLength: 4 }),
    prepMinutes: fc.integer({ min: 5, max: 60 }),
    costTier: fc.constantFrom(1 as const, 2 as const, 3 as const),
  });
const libraryArb = fc
  .integer({ min: 1, max: 14 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => recipeArb(i))));
const scenarioArb = fc.record({
  recipes: libraryArb,
  dietType: fc.constantFrom(...DIETS),
  allergens: fc.subarray(ALLERGENS, { maxLength: 3 }),
  dislikedFoodIds: fc.subarray(['a', 'b', 'c'], { maxLength: 1 }),
  energy: fc.integer({ min: 1200, max: 3500 }),
  fasting: fc.boolean(),
});

describe('meal-plan properties', () => {
  it('never includes a declared allergen, a diet violation or a disliked food (TC-NU-8)', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const plan = generateMealPlan({
          ...base,
          days: 3,
          recipes: s.recipes,
          targets: { energyKcal: s.energy, proteinG: 90, fibreG: 25 },
          fastingDates: s.fasting ? ['2026-11-03'] : [],
          preferences: {
            dietType: s.dietType,
            allergens: s.allergens,
            dislikedFoodIds: s.dislikedFoodIds,
          },
        });
        const index = new Map(s.recipes.map((r) => [r.id, r]));
        for (const day of plan.days) {
          for (const item of day.items) {
            const recipe = index.get(item.recipeId)!;
            for (const ing of recipe.ingredients) {
              expect(ing.allergens.some((a) => s.allergens.includes(a))).toBe(false);
              expect(ing.flags.some((f) => DIET_EXCLUSIONS[s.dietType].includes(f))).toBe(false);
              expect(s.dislikedFoodIds).not.toContain(ing.foodId);
              if (day.fasting) expect(ing.flags).toContain('FASTING_OK');
            }
            expect(recipe.slots).toContain(item.slot);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('grocery totals equal the sum of plan ingredient grams before rounding (AC 2)', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const input = {
          ...base,
          days: 3,
          recipes: s.recipes,
          preferences: { dietType: 'NON_VEGETARIAN' as const, allergens: [] },
        };
        const plan = generateMealPlan(input);
        const list = groceryList(plan, s.recipes);
        const index = new Map(s.recipes.map((r) => [r.id, r]));
        const expected = sum(
          plan.days.flatMap((d) =>
            d.items.flatMap((i) =>
              index
                .get(i.recipeId)!
                .ingredients.map((ing) => dec(ing.gramsPerServing).times(i.servings)),
            ),
          ),
        );
        const items = list.aisles.flatMap((a) => a.items);
        expect(list.totalGrams.eq(expected)).toBe(true);
        expect(sum(items.map((i) => i.grams)).eq(expected)).toBe(true);
        for (const item of items) {
          expect(item.displayGrams).toBeGreaterThanOrEqual(item.grams.toNumber());
          if (item.packs !== null) expect(item.packs).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('groceryList', () => {
  it('aggregates by food, groups by aisle and rounds to packs', () => {
    const plan = generateMealPlan({ ...base, days: 7 });
    const list = groceryList(plan, RECIPES);
    const rice = list.aisles
      .find((a) => a.aisle === 'grains')!
      .items.find((i) => i.foodId === 'rice');
    if (rice) expect(rice.packs).toBe(rice.grams.div(1000).ceil().toNumber());
    const aisles = list.aisles.map((a) => a.aisle);
    expect(aisles).toEqual([...aisles].sort());
  });
});

describe('suggestAlternatives', () => {
  const candidates = [
    {
      id: 'thali',
      name: 'Veg thali',
      contexts: ['eating_out' as const],
      perServing: { energyKcal: 650, proteinG: 18, carbsG: 95, fatG: 20 },
      confidence: 'MEDIUM' as const,
      allergens: ['milk'],
      flags: ['DAIRY' as const],
    },
    {
      id: 'tandoori',
      name: 'Tandoori chicken (half)',
      contexts: ['eating_out' as const],
      perServing: { energyKcal: 400, proteinG: 45, carbsG: 5, fatG: 20 },
      confidence: 'MEDIUM' as const,
      allergens: [],
      flags: ['MEAT' as const],
    },
    {
      id: 'dosa',
      name: 'Plain dosa + sambar',
      contexts: ['eating_out' as const, 'travel' as const],
      perServing: { energyKcal: 380, proteinG: 10, carbsG: 60, fatG: 10 },
      confidence: 'LOW' as const,
      allergens: [],
      flags: [],
    },
    {
      id: 'chana-pack',
      name: 'Roasted chana pack',
      contexts: ['no_cooking' as const, 'travel' as const],
      perServing: { energyKcal: 180, proteinG: 10, carbsG: 28, fatG: 3 },
      confidence: 'HIGH' as const,
      allergens: [],
      flags: [],
    },
  ];

  it('ranks by macro fit within the context and respects diet and allergens', () => {
    const remaining = { energyKcal: 450, proteinG: 40, carbsG: 20, fatG: 18 };
    const nonVeg = suggestAlternatives({
      slot: 'DINNER',
      context: 'eating_out',
      remaining,
      preferences: { dietType: 'NON_VEGETARIAN', allergens: [] },
      candidates,
    });
    expect(nonVeg[0]!.id).toBe('tandoori');
    expect(nonVeg.map((a) => a.id)).not.toContain('chana-pack');
    const veg = suggestAlternatives({
      slot: 'DINNER',
      context: 'eating_out',
      remaining,
      preferences: { dietType: 'VEGETARIAN', allergens: ['milk'] },
      candidates,
    });
    expect(veg.map((a) => a.id)).toEqual(['dosa']);
    expect(veg[0]!.confidence).toBe('LOW');
    for (const a of nonVeg) expect(a.fitScore).toBeGreaterThanOrEqual(0);
  });
});
