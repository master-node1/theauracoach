import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, stateOf } from '../src/import/classify';
import { parseCsv } from '../src/import/csv';
import { fdcRecords, readFdcDirectory } from '../src/import/fdc';
import { readIfctFile } from '../src/import/ifct';

const fixtures = resolve(__dirname, 'fixtures');

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,\n');
    expect(rows).toEqual([
      { a: 'x, y', b: 'say "hi"' },
      { a: '1', b: '' },
    ]);
  });
});

describe('USDA FDC importer', () => {
  const { records, skipped } = fdcRecords(readFdcDirectory(resolve(fixtures, 'fdc')));
  const byRef = new Map(records.map((r) => [r.sourceRef, r]));

  it('keeps Foundation and SR Legacy foods and skips incomplete or branded ones', () => {
    expect([...byRef.keys()].sort()).toEqual(['169756', '170567', '171287', '171477', '2346393']);
    expect(skipped).toEqual([{ ref: '2000002', reason: 'missing energy or macronutrients' }]);
  });

  it('stores available carbohydrate (by difference minus fibre) and falls back to Atwater energy', () => {
    const peanuts = byRef.get('170567')!;
    expect(peanuts.nutrients).toMatchObject({
      energyKcal: 567,
      proteinG: 25.8,
      carbsG: 7.63,
      fatG: 49.24,
      fibreG: 8.5,
      sugarG: 4.72,
      sodiumMg: 18,
    });
    expect(byRef.get('2346393')!.nutrients.energyKcal).toBe(359);
  });

  it('tags diets, allergens, state and portions', () => {
    expect(byRef.get('170567')).toMatchObject({ allergens: ['peanut'], state: 'RAW', category: 'nut' });
    expect(byRef.get('170567')!.units).toEqual([{ code: 'cup', label: 'cup', grams: 146 }]);
    expect(byRef.get('171287')).toMatchObject({ flags: ['EGG'], allergens: ['egg'], category: 'egg' });
    expect(byRef.get('171477')).toMatchObject({ flags: ['MEAT'], state: 'COOKED', category: 'meat' });
    expect(byRef.get('169756')!.units.map((u) => u.code)).toEqual(['cup']);
    expect(byRef.get('169756')).toMatchObject({ source: 'USDA_FDC', confidence: 'HIGH' });
  });
});

describe('IFCT 2017 importer', () => {
  const { records, skipped } = readIfctFile(resolve(fixtures, 'ifct.csv'));
  const byRef = new Map(records.map((r) => [r.sourceRef, r]));

  it('reads INFOODS columns and converts kJ to kcal', () => {
    expect(byRef.get('A015')).toMatchObject({
      name: 'Rice, raw, milled',
      localNames: ['chawal', 'arisi'],
      category: 'cereal',
      nutrients: { energyKcal: 356.4, proteinG: 7.94, carbsG: 78.24, fatG: 0.52, fibreG: 2.81 },
    });
    expect(byRef.get('L002')).toMatchObject({ flags: ['DAIRY'], allergens: ['milk'] });
    expect(byRef.get('O019')).toMatchObject({ flags: ['MEAT'], category: 'meat' });
    expect(skipped.map((s) => s.ref)).toEqual(['X999', 'B030']);
  });
});

describe('classification', () => {
  it('errs towards tagging', () => {
    expect(classify('vegetable', 'Onions, raw').flags).toEqual(['ONION']);
    expect(classify('fish', 'Shrimp, mixed species').allergens).toEqual(['fish', 'shellfish']);
    expect(classify('cereal', 'Wheat flour, whole-grain').allergens).toEqual(['gluten']);
    expect(stateOf('Potatoes, boiled, cooked in skin', 'AS_SOLD')).toBe('COOKED');
  });
});
