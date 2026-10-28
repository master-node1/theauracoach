import { readFileSync } from 'node:fs';
import type { NutrientValues } from '../catalogue/nutrients';
import type { FoodRecord } from '../catalogue/records';
import { classify } from './classify';
import { cellNumber, parseCsv } from './csv';

/**
 * Indian Food Composition Tables 2017 (NIN) importer. IFCT is licensed: the owner supplies the CSV
 * (TAC-44) and it is never committed. Expected columns, by INFOODS tagname:
 * `code, name, local_names (semicolon separated, optional), ENERC (kJ), PROTCNT, FATCE, CHOAVLDF,
 * FIBTG, FREESUGAR?, NA?, FE?, CA?, VITB12?, VITD?` with values per 100 g edible portion
 * (minerals in mg, vitamins in µg). The code's letter is the IFCT food group.
 */

const GROUPS: Record<string, [category: string, classifierGroup: string]> = {
  A: ['cereal', 'cereal'],
  B: ['pulse', 'pulse'],
  C: ['leafy_vegetable', 'vegetable'],
  D: ['vegetable', 'vegetable'],
  E: ['fruit', 'fruit'],
  F: ['vegetable', 'vegetable'],
  G: ['spice', 'spice'],
  H: ['nut', 'nut'],
  I: ['sweetener', 'sweetener'],
  J: ['vegetable', 'vegetable'],
  K: ['other', 'other'],
  L: ['dairy', 'dairy'],
  M: ['egg', 'egg'],
  N: ['meat', 'poultry'],
  O: ['meat', 'meat'],
  P: ['fish', 'fish'],
  Q: ['fish', 'shellfish'],
  R: ['fish', 'shellfish'],
  S: ['fish', 'fish'],
  T: ['fat', 'fat'],
};

export interface IfctResult {
  records: FoodRecord[];
  skipped: { ref: string; reason: string }[];
}

export function ifctRecords(csvText: string): IfctResult {
  const records: FoodRecord[] = [];
  const skipped: IfctResult['skipped'] = [];
  for (const row of parseCsv(csvText)) {
    const code = row.code ?? '';
    const group = GROUPS[code.charAt(0).toUpperCase()];
    if (!/^[A-Ta-t]\d{3}$/.test(code) || !group) {
      skipped.push({ ref: code || '(blank)', reason: 'not an IFCT food code' });
      continue;
    }
    const kj = cellNumber(row.ENERC);
    const required = [kj, cellNumber(row.PROTCNT), cellNumber(row.FATCE), cellNumber(row.CHOAVLDF)];
    if (required.some((v) => v === undefined) || !row.name) {
      skipped.push({ ref: code, reason: 'missing name, energy or macronutrients' });
      continue;
    }
    const nutrients: NutrientValues = {
      energyKcal: Math.round((kj! / 4.184) * 10) / 10,
      proteinG: cellNumber(row.PROTCNT)!,
      carbsG: cellNumber(row.CHOAVLDF)!,
      fatG: cellNumber(row.FATCE)!,
      fibreG: cellNumber(row.FIBTG) ?? 0,
    };
    const optional: [keyof NutrientValues, string | undefined][] = [
      ['sugarG', row.FREESUGAR],
      ['sodiumMg', row.NA],
      ['ironMg', row.FE],
      ['calciumMg', row.CA],
      ['vitaminB12Ug', row.VITB12],
      ['vitaminDUg', row.VITD],
    ];
    for (const [k, v] of optional) {
      const n = cellNumber(v);
      if (n !== undefined) nutrients[k] = n;
    }
    const [category, classifierGroup] = group;
    const cls = classify(classifierGroup, row.name);
    records.push({
      slug: null,
      name: row.name.slice(0, 120),
      localNames: (row.local_names ?? '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 12),
      source: 'IFCT_2017',
      sourceRef: code.toUpperCase(),
      confidence: 'HIGH',
      state: 'RAW',
      category,
      cuisine: null,
      flags: cls.flags,
      allergens: cls.allergens,
      densityGPerMl: null,
      yieldFactor: null,
      rawEquivalentRef: null,
      nutrients,
      units: [],
      reviewRequired: null,
    });
  }
  return { records, skipped };
}

export function readIfctFile(path: string): IfctResult {
  return ifctRecords(readFileSync(path, 'utf8'));
}
