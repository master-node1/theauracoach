import { describe, expect, it } from 'vitest';
import {
  NutritionDomainError,
  normaliseServing,
  round,
  scaleNutrients,
  sum,
  type ServingFood,
} from '../../src/nutrition';

const dal: ServingFood = {
  id: 'dal-tadka',
  state: 'COOKED',
  per100g: { energyKcal: 113.25, proteinG: 5.6, fatG: 3.1 },
  confidence: 'HIGH',
  units: [
    { code: 'katori', grams: 150 },
    { code: 'tbsp', grams: 15 },
  ],
};
const roti: ServingFood = {
  id: 'roti',
  state: 'COOKED',
  per100g: { energyKcal: 297, proteinG: 9.8 },
  confidence: 'HIGH',
  units: [{ code: 'roti', grams: 40 }],
};
const milk: ServingFood = {
  id: 'milk-toned',
  state: 'RAW',
  per100g: { energyKcal: 58, proteinG: 3.1, calciumMg: 120 },
  confidence: 'HIGH',
  densityGPerMl: 1.03,
};
const rice: ServingFood = {
  id: 'rice-raw',
  state: 'RAW',
  per100g: { energyKcal: 356, proteinG: 7.9 },
  confidence: 'HIGH',
  yieldFactor: 2.5,
};
const unitError = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof NutritionDomainError ? e.code : 'OTHER';
  }
  return 'NONE';
};

describe('normaliseServing — units (TC-NU-4)', () => {
  it('converts household units to grams', () => {
    const r = normaliseServing({ food: dal, quantity: 1.5, unitCode: 'katori' });
    expect(r.grams.toNumber()).toBe(225);
    expect(r.nutrients.energyKcal!.toString()).toBe('254.8125');
    expect(normaliseServing({ food: roti, quantity: 2, unitCode: 'roti' }).grams.toNumber()).toBe(
      80,
    );
  });

  it('converts ml with the food density, and g / kg directly', () => {
    expect(normaliseServing({ food: milk, quantity: 200, unitCode: 'ml' }).grams.toNumber()).toBe(
      206,
    );
    expect(normaliseServing({ food: milk, quantity: 0.25, unitCode: 'kg' }).grams.toNumber()).toBe(
      250,
    );
    expect(normaliseServing({ food: milk, quantity: 30, unitCode: 'g' }).grams.toNumber()).toBe(30);
  });

  it('rejects ml without density and unknown units with UNIT_NOT_SUPPORTED', () => {
    expect(unitError(() => normaliseServing({ food: dal, quantity: 100, unitCode: 'ml' }))).toBe(
      'UNIT_NOT_SUPPORTED',
    );
    expect(unitError(() => normaliseServing({ food: dal, quantity: 1, unitCode: 'cup' }))).toBe(
      'UNIT_NOT_SUPPORTED',
    );
    expect(unitError(() => normaliseServing({ food: dal, quantity: 0, unitCode: 'g' }))).toBe(
      'INVALID_INPUT',
    );
  });
});

describe('normaliseServing — raw and cooked (TC-NU-5)', () => {
  it('uses the catalogued state as is', () => {
    const r = normaliseServing({ food: rice, quantity: 50, unitCode: 'g', state: 'RAW' });
    expect(r.nutrients.energyKcal!.toNumber()).toBe(178);
    expect(r.confidence).toBe('HIGH');
    expect(r.rationale).toEqual(['STATE_AS_CATALOGUED']);
  });

  it('cooked grams of a raw food without a cooked form use the yield factor and lower confidence', () => {
    // 250 g cooked rice = 100 g raw = 356 kcal
    const r = normaliseServing({ food: rice, quantity: 250, unitCode: 'g', state: 'COOKED' });
    expect(r.grams.toNumber()).toBe(250);
    expect(r.nutrients.energyKcal!.toNumber()).toBe(356);
    expect(r.confidence).toBe('MEDIUM');
    expect(r.rationale).toEqual(['YIELD_CONVERSION']);
  });

  it('prefers a catalogued cooked form over the yield conversion', () => {
    const withCooked: ServingFood = {
      ...rice,
      cookedForm: { per100g: { energyKcal: 130 }, confidence: 'HIGH' },
    };
    const r = normaliseServing({ food: withCooked, quantity: 200, unitCode: 'g', state: 'COOKED' });
    expect(r.nutrients.energyKcal!.toNumber()).toBe(260);
    expect(r.confidence).toBe('HIGH');
    expect(r.rationale).toEqual(['COOKED_FORM_USED']);
  });

  it('raw grams of a cooked food use its raw equivalent', () => {
    const withRaw: ServingFood = {
      ...dal,
      rawEquivalent: { per100g: { energyKcal: 343 }, confidence: 'MEDIUM' },
    };
    const r = normaliseServing({ food: withRaw, quantity: 30, unitCode: 'g', state: 'RAW' });
    expect(r.nutrients.energyKcal!.toNumber()).toBe(102.9);
    expect(r.confidence).toBe('MEDIUM');
    expect(r.rationale).toEqual(['RAW_EQUIVALENT_USED']);
  });

  it('rejects a state change it has no data for', () => {
    expect(
      unitError(() => normaliseServing({ food: dal, quantity: 30, unitCode: 'g', state: 'RAW' })),
    ).toBe('STATE_NOT_SUPPORTED');
    expect(
      unitError(() =>
        normaliseServing({ food: milk, quantity: 30, unitCode: 'g', state: 'COOKED' }),
      ),
    ).toBe('STATE_NOT_SUPPORTED');
  });
});

describe('Decimal maths (AC 3: no floating-point drift)', () => {
  it('sums many small entries exactly and rounds only at display', () => {
    const entries = Array.from({ length: 1000 }, () =>
      scaleNutrients({ energyKcal: '33.3' }, '0.3'),
    );
    const total = sum(entries.map((e) => e.energyKcal!));
    expect(total.toString()).toBe('99.9');
    // The same sum in binary floating point drifts.
    const floats = Array.from({ length: 1000 }, () => (33.3 * 0.3) / 100).reduce(
      (a, b) => a + b,
      0,
    );
    expect(floats).not.toBe(99.9);
    expect(round(total)).toBe(100);
    expect(round(total, 1)).toBe(99.9);
  });

  it('keeps unknown nutrients unknown instead of zero', () => {
    const r = normaliseServing({ food: roti, quantity: 1, unitCode: 'roti' });
    expect(r.nutrients.fatG).toBeUndefined();
  });
});
