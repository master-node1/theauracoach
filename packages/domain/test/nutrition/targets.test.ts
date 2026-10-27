import { describe, expect, it } from 'vitest';
import { calculateTargets, energyFloor, type TargetsInput } from '../../src/nutrition';

/**
 * TC-NU-1: Mifflin-St Jeor golden values for 10 personas. Expected numbers were worked by hand
 * from the LLD §2 formulas (not by running the engine). Macros: protein g/kg × reference weight,
 * fat = 25% of energy ÷ 9 (min 0.6 g/kg), carbs = (energy − 4P − 9F) ÷ 4, each rounded half-up.
 */
interface Golden {
  name: string;
  input: TargetsInput;
  bmr: number;
  tdee: number;
  energy: number;
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
  water: number;
  codes?: string[];
}

const personas: Golden[] = [
  {
    // BMR 800 + 1093.75 − 150 + 5 = 1748.75; TDEE ×1.55 = 2710.5625; deficit 80×0.5%×7700/7 = 440
    name: 'man 30, 175 cm, 80 kg, moderate, fat loss',
    input: {
      sex: 'MALE',
      ageYears: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: 'MODERATE',
      goal: 'FAT_LOSS',
    },
    bmr: 1748.75,
    tdee: 2710.5625,
    energy: 2271,
    protein: 144,
    fat: 63,
    carbs: 282,
    fibre: 32,
    water: 2800,
    codes: ['GOAL_DEFICIT'],
  },
  {
    // BMR 600 + 1000 − 140 − 161 = 1299; TDEE ×1.375 = 1786.125; deficit 330; fibre 20.4 → 25 minimum
    name: 'woman 28, 160 cm, 60 kg, light, fat loss',
    input: {
      sex: 'FEMALE',
      ageYears: 28,
      heightCm: 160,
      weightKg: 60,
      activityLevel: 'LIGHT',
      goal: 'FAT_LOSS',
    },
    bmr: 1299,
    tdee: 1786.125,
    energy: 1456,
    protein: 108,
    fat: 40,
    carbs: 166,
    fibre: 25,
    water: 2100,
    codes: ['FIBRE_MIN_APPLIED'],
  },
  {
    // BMR 1082.75; TDEE 1299.3; deficit 550 → 749.3 below the 1200 kcal female floor
    name: 'woman 45, 155 cm, 50 kg, sedentary, fat loss 1%/week',
    input: {
      sex: 'FEMALE',
      ageYears: 45,
      heightCm: 155,
      weightKg: 50,
      activityLevel: 'SEDENTARY',
      goal: 'FAT_LOSS',
      weeklyLossPct: 1,
    },
    bmr: 1082.75,
    tdee: 1299.3,
    energy: 1200,
    protein: 90,
    fat: 33,
    carbs: 136,
    fibre: 25,
    water: 1750,
    codes: ['FLOOR_APPLIED'],
  },
  {
    // BMR 1705; TDEE ×1.725 = 2941.125; beginner surplus +350
    name: 'man 25, 180 cm, 70 kg, active, muscle gain beginner',
    input: {
      sex: 'MALE',
      ageYears: 25,
      heightCm: 180,
      weightKg: 70,
      activityLevel: 'ACTIVE',
      goal: 'MUSCLE_GAIN',
      experience: 'BEGINNER',
    },
    bmr: 1705,
    tdee: 2941.125,
    energy: 3291,
    protein: 126,
    fat: 91,
    carbs: 492,
    fibre: 46,
    water: 2450,
    codes: ['GOAL_SURPLUS_BEGINNER'],
  },
  {
    // BMI 34.6 → protein from weight at BMI 27 (78.03 kg × 1.8 = 140.45); 1691 kcal below BMR floor 1868
    name: 'man 40, 170 cm, 100 kg, sedentary, fat loss',
    input: {
      sex: 'MALE',
      ageYears: 40,
      heightCm: 170,
      weightKg: 100,
      activityLevel: 'SEDENTARY',
      goal: 'FAT_LOSS',
    },
    bmr: 1867.5,
    tdee: 2241,
    energy: 1868,
    protein: 140,
    fat: 52,
    carbs: 210,
    fibre: 26,
    water: 3500,
    codes: ['FLOOR_APPLIED', 'PROTEIN_ADJUSTED_WEIGHT'],
  },
  {
    // BMR 1420.25; TDEE 2201.3875; surplus +250
    name: 'woman 30, 165 cm, 70 kg, moderate, muscle gain',
    input: {
      sex: 'FEMALE',
      ageYears: 30,
      heightCm: 165,
      weightKg: 70,
      activityLevel: 'MODERATE',
      goal: 'MUSCLE_GAIN',
      experience: 'INTERMEDIATE',
    },
    bmr: 1420.25,
    tdee: 2201.3875,
    energy: 2451,
    protein: 126,
    fat: 68,
    carbs: 334,
    fibre: 34,
    water: 2450,
    codes: ['GOAL_SURPLUS'],
  },
  {
    // BMR 1692.5; TDEE ×1.9 = 3215.75; endurance with 6 sessions +5% = 3376.54
    name: 'man 35, 178 cm, 75 kg, very active, endurance 6×/week',
    input: {
      sex: 'MALE',
      ageYears: 35,
      heightCm: 178,
      weightKg: 75,
      activityLevel: 'VERY_ACTIVE',
      goal: 'ENDURANCE',
      trainingDaysPerWeek: 6,
    },
    bmr: 1692.5,
    tdee: 3215.75,
    energy: 3377,
    protein: 105,
    fat: 94,
    carbs: 528,
    fibre: 47,
    water: 2625,
    codes: ['ENDURANCE_VOLUME_BONUS'],
  },
  {
    // BMR 1176.5; TDEE 1617.6875; maintenance
    name: 'woman 60, 158 cm, 65 kg, light, general fitness',
    input: {
      sex: 'FEMALE',
      ageYears: 60,
      heightCm: 158,
      weightKg: 65,
      activityLevel: 'LIGHT',
      goal: 'GENERAL_FITNESS',
    },
    bmr: 1176.5,
    tdee: 1617.6875,
    energy: 1618,
    protein: 78,
    fat: 45,
    carbs: 225,
    fibre: 25,
    water: 2275,
    codes: ['GOAL_MAINTENANCE'],
  },
  {
    // BMR 2001.25; TDEE 3101.9375; BMI 27.8 < 30 so actual weight for protein
    name: 'man 22, 185 cm, 95 kg, moderate, strength',
    input: {
      sex: 'MALE',
      ageYears: 22,
      heightCm: 185,
      weightKg: 95,
      activityLevel: 'MODERATE',
      goal: 'STRENGTH',
    },
    bmr: 2001.25,
    tdee: 3101.9375,
    energy: 3102,
    protein: 152,
    fat: 86,
    carbs: 430,
    fibre: 43,
    water: 3325,
  },
  {
    // TC-ONB-4: BMR 1371.5; TDEE 2125.825; pregnancy → maintenance, no deficit
    name: 'woman 32, 162 cm, 68 kg, moderate, fat loss but pregnant',
    input: {
      sex: 'FEMALE',
      ageYears: 32,
      heightCm: 162,
      weightKg: 68,
      activityLevel: 'MODERATE',
      goal: 'FAT_LOSS',
      pregnant: true,
    },
    bmr: 1371.5,
    tdee: 2125.825,
    energy: 2126,
    protein: 122,
    fat: 59,
    carbs: 277,
    fibre: 30,
    water: 2380,
    codes: ['PREGNANCY_MAINTENANCE'],
  },
];

describe('calculateTargets — golden personas (TC-NU-1)', () => {
  it.each(personas)('$name', (p) => {
    const t = calculateTargets(p.input);
    expect(t.basis.bmrKcal.toNumber()).toBe(p.bmr);
    expect(t.basis.tdeeKcal.toNumber()).toBe(p.tdee);
    expect(t.energyKcal).toBe(p.energy);
    expect(t.proteinG).toBe(p.protein);
    expect(t.fatG).toBe(p.fat);
    expect(t.carbsG).toBe(p.carbs);
    expect(t.fibreG).toBe(p.fibre);
    expect(t.waterMl.restDay).toBe(p.water);
    expect(t.waterMl.trainingDay).toBe(p.water + 500);
    expect(t.estimate).toBe(true);
    expect(t.notices).toContain('ESTIMATE');
    for (const code of p.codes ?? []) expect(t.rationale).toContain(code);
  });
});

describe('safety floors (TC-NU-2)', () => {
  it('uses 1200 kcal for women and 1500 kcal for men when above BMR', () => {
    const body = { ageYears: 70, heightCm: 150, weightKg: 45 };
    expect(energyFloor({ sex: 'FEMALE', ...body })).toBe(1200);
    expect(energyFloor({ sex: 'MALE', ...body })).toBe(1500);
  });

  it('uses BMR when BMR is higher, and records FLOOR_APPLIED', () => {
    const t = calculateTargets(personas[4]!.input);
    expect(t.basis.floorKcal).toBe(1868);
    expect(t.energyKcal).toBe(1868);
    expect(t.rationale).toContain('FLOOR_APPLIED');
  });

  it('never returns energy below the floor, whatever the requested rate', () => {
    for (const weeklyLossPct of [0.25, 0.5, 1, 3]) {
      const t = calculateTargets({ ...personas[1]!.input, weeklyLossPct });
      expect(t.energyKcal).toBeGreaterThanOrEqual(t.basis.floorKcal);
    }
  });

  it('caps the loss rate at 1%/week and clamps the deficit to 250–750 kcal', () => {
    const fast = calculateTargets({ ...personas[0]!.input, weeklyLossPct: 2 });
    expect(fast.rationale).toEqual(expect.arrayContaining(['RATE_CAPPED', 'DEFICIT_CLAMPED']));
    expect(fast.basis.weeklyLossPct).toBe(1);
    expect(fast.basis.goalAdjustmentKcal.toNumber()).toBe(-750);
    const slow = calculateTargets({ ...personas[0]!.input, weeklyLossPct: 0.1 });
    expect(slow.basis.goalAdjustmentKcal.toNumber()).toBe(-250);
  });
});

describe('protein (TC-NU-3)', () => {
  it('uses weight at BMI 27 when BMI ≥ 30, actual weight below 30', () => {
    const heavy = calculateTargets({ ...personas[4]!.input });
    expect(heavy.basis.referenceWeightKg.toNumber()).toBeCloseTo(78.03, 10);
    expect(heavy.rationale).toContain('PROTEIN_ADJUSTED_WEIGHT');
    const lighter = calculateTargets({ ...personas[4]!.input, weightKg: 86 }); // BMI 29.76
    expect(lighter.basis.referenceWeightKg.toNumber()).toBe(86);
    expect(lighter.rationale).not.toContain('PROTEIN_ADJUSTED_WEIGHT');
  });
});

describe('pregnancy (TC-ONB-4)', () => {
  it('never applies a deficit and adds the professional-advice notice', () => {
    for (const goal of ['FAT_LOSS', 'MUSCLE_GAIN', 'GENERAL_FITNESS'] as const) {
      const t = calculateTargets({ ...personas[9]!.input, goal, weeklyLossPct: 1 });
      expect(t.basis.goalAdjustmentKcal.toNumber()).toBe(0);
      expect(t.energyKcal).toBe(2126);
      expect(t.notices).toContain('PROFESSIONAL_ADVICE_PREGNANCY');
      expect(t.micros.ironMg).toBe(27);
    }
  });
});

describe('macros, micros and validation', () => {
  it('raises fat to 0.6 g/kg when 25% of energy is less', () => {
    const t = calculateTargets({
      sex: 'MALE',
      ageYears: 30,
      heightCm: 190,
      weightKg: 120,
      activityLevel: 'SEDENTARY',
      goal: 'FAT_LOSS',
      weeklyLossPct: 1,
    });
    // BMI 33.2 → reference 97.47 kg → fat ≥ 58.5 g
    expect(t.fatG).toBeGreaterThanOrEqual(58);
  });

  it('keeps carbs at the remainder for low-carb users', () => {
    const t = calculateTargets({ ...personas[2]!.input, lowCarb: true });
    expect(t.rationale).toContain('LOW_CARB_CHOSEN');
    expect(t.rationale).not.toContain('CARB_MIN_APPLIED');
  });

  it('macro energy is within rounding of the energy target', () => {
    for (const p of personas) {
      const t = calculateTargets(p.input);
      const macroKcal = t.proteinG * 4 + t.fatG * 9 + t.carbsG * 4;
      expect(Math.abs(macroKcal - t.energyKcal)).toBeLessThanOrEqual(6);
    }
  });

  it('returns ICMR-NIN 2020 micros by sex and age', () => {
    expect(calculateTargets(personas[1]!.input).micros).toEqual({
      ironMg: 29,
      calciumMg: 1000,
      vitaminB12Ug: 2.5,
      vitaminDUg: 15,
      sodiumMaxMg: 2000,
    });
    expect(calculateTargets(personas[7]!.input).micros.calciumMg).toBe(1200);
    expect(calculateTargets(personas[0]!.input).micros.ironMg).toBe(19);
  });

  it('rejects minors and impossible bodies', () => {
    expect(() => calculateTargets({ ...personas[0]!.input, ageYears: 17 })).toThrow(/ageYears/);
    expect(() => calculateTargets({ ...personas[0]!.input, heightCm: 20 })).toThrow(/heightCm/);
  });
});
