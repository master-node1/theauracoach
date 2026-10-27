import { describe, expect, it } from 'vitest';
import { compositeRecipe, NutritionDomainError, type IngredientFood } from '../../src/nutrition';

const toorDal: IngredientFood = {
  id: 'toor-dal',
  per100g: { energyKcal: 343, proteinG: 22.3, fatG: 1.7, fibreG: 9 },
  confidence: 'HIGH',
  allergens: [],
  flags: ['FASTING_OK'],
};
const ghee: IngredientFood = {
  id: 'ghee',
  per100g: { energyKcal: 900, fatG: 100 },
  confidence: 'HIGH',
  allergens: ['milk'],
  flags: ['DAIRY', 'OIL', 'FASTING_OK'],
};
const onion: IngredientFood = {
  id: 'onion',
  per100g: { energyKcal: 40, proteinG: 1.1, fibreG: 1.7 },
  confidence: 'MEDIUM',
  allergens: [],
  flags: ['ONION'],
};

describe('compositeRecipe', () => {
  it('sums raw ingredients and divides by the cooked yield', () => {
    // 343 + 90 + 20 = 453 kcal in 400 g cooked → 113.25 kcal/100 g
    const r = compositeRecipe({
      ingredients: [
        { food: toorDal, grams: 100 },
        { food: ghee, grams: 10 },
        { food: onion, grams: 50 },
      ],
      cookedYieldG: 400,
      yieldMeasured: true,
      householdUnits: [{ code: 'katori', grams: 150 }],
    });
    expect(r.totals.energyKcal!.toNumber()).toBe(453);
    expect(r.per100g.energyKcal!.toNumber()).toBe(113.25);
    expect(r.per100g.proteinG!.toNumber()).toBeCloseTo(5.7125, 10);
    expect(r.rawWeightG.toNumber()).toBe(160);
    expect(r.oilG.toNumber()).toBe(10);
    expect(r.householdUnits).toEqual([{ code: 'katori', grams: 150 }]);
  });

  it('derives allergens, flags and diets from ingredients', () => {
    const r = compositeRecipe({
      ingredients: [
        { food: toorDal, grams: 100 },
        { food: ghee, grams: 10 },
        { food: onion, grams: 50 },
      ],
      cookedYieldG: 400,
      yieldMeasured: true,
    });
    expect(r.allergens).toEqual(['milk']);
    expect(r.compatibleDiets).toContain('VEGETARIAN');
    expect(r.compatibleDiets).not.toContain('VEGAN');
    expect(r.compatibleDiets).not.toContain('JAIN');
    expect(r.fastingOk).toBe(false);

    const jain = compositeRecipe({
      ingredients: [
        { food: toorDal, grams: 100 },
        { food: ghee, grams: 10 },
      ],
      cookedYieldG: 350,
      yieldMeasured: true,
    });
    expect(jain.compatibleDiets).toContain('JAIN');
    expect(jain.fastingOk).toBe(true);
  });

  it('sets confidence: HIGH, MEDIUM for estimated yield or medium ingredient, LOW for any low', () => {
    const high = compositeRecipe({
      ingredients: [{ food: toorDal, grams: 100 }],
      cookedYieldG: 300,
      yieldMeasured: true,
    });
    expect(high.confidence).toBe('HIGH');
    const estimated = compositeRecipe({
      ingredients: [{ food: toorDal, grams: 100 }],
      cookedYieldG: 300,
      yieldMeasured: false,
    });
    expect(estimated.confidence).toBe('MEDIUM');
    expect(estimated.rationale).toContain('YIELD_ESTIMATED');
    const medium = compositeRecipe({
      ingredients: [{ food: onion, grams: 100 }],
      cookedYieldG: 80,
      yieldMeasured: true,
    });
    expect(medium.confidence).toBe('MEDIUM');
    const low = compositeRecipe({
      ingredients: [
        { food: toorDal, grams: 100 },
        { food: { ...onion, confidence: 'LOW' }, grams: 10 },
      ],
      cookedYieldG: 300,
      yieldMeasured: true,
      restaurantStyle: true,
    });
    expect(low.confidence).toBe('LOW');
    expect(low.rationale).toEqual(
      expect.arrayContaining(['LOW_CONFIDENCE_INGREDIENT', 'RESTAURANT_FAT_NOTE']),
    );
  });

  it('rejects empty recipes and missing yields', () => {
    expect(() =>
      compositeRecipe({ ingredients: [], cookedYieldG: 100, yieldMeasured: true }),
    ).toThrow(NutritionDomainError);
    expect(() =>
      compositeRecipe({
        ingredients: [{ food: toorDal, grams: 100 }],
        cookedYieldG: 0,
        yieldMeasured: true,
      }),
    ).toThrow(/cookedYieldG/);
    expect(() =>
      compositeRecipe({
        ingredients: [{ food: toorDal, grams: 0 }],
        cookedYieldG: 10,
        yieldMeasured: true,
      }),
    ).toThrow(/grams/);
  });
});
