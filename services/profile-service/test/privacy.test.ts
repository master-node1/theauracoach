import { planProblems } from '@aura/service-kit';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma';
import { toCsv } from '../src/privacy/export-archive';
import { userDataPlan } from '../src/privacy/user-data-plan';

describe('profile-service user data plan', () => {
  it('classifies every table in the schema (TC-PRV-1)', () => {
    expect(planProblems(userDataPlan, Prisma.dmmf.datamodel.models)).toEqual([]);
  });
});

describe('export CSV', () => {
  it('quotes separators, keeps numbers and neutralises formulas', () => {
    const csv = toCsv([
      { a: 'x,y', b: -1.5, c: '-2', d: '=SUM(A1)', e: { k: 1 } },
      { a: 'say "hi"', f: null },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'a,b,c,d,e,f',
      `"x,y",-1.5,-2,'=SUM(A1),"{""k"":1}",`,
      '"say ""hi""",,,,,',
      '',
    ]);
  });
});
