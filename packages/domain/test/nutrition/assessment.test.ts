import { describe, expect, it } from 'vitest';
import { addDays, assess, bmiCategory } from '../../src/nutrition';

const base = {
  sex: 'MALE' as const,
  ageYears: 30,
  heightCm: 175,
  weightKg: 80,
  activityLevel: 'MODERATE' as const,
  today: '2026-11-02',
};

describe('assess', () => {
  it('uses Asia-Pacific BMI cut-offs (23 / 27.5) with a population caveat', () => {
    expect(bmiCategory(18.4)).toBe('UNDERWEIGHT');
    expect(bmiCategory(22.9)).toBe('NORMAL');
    expect(bmiCategory(23)).toBe('OVERWEIGHT');
    expect(bmiCategory(27.4)).toBe('OVERWEIGHT');
    expect(bmiCategory(27.5)).toBe('OBESE');
    const a = assess({ ...base, goal: 'FAT_LOSS' });
    expect(a.bmi).toBe(26.1);
    expect(a.bmiCategory).toBe('OVERWEIGHT');
    expect(a.notices).toContain('BMI_POPULATION_CAVEAT');
    expect(a.rationale).toContain('BMI_ASIA_PACIFIC_CUTOFFS');
  });

  it('reports BMR, TDEE and the recommended rate and range', () => {
    const a = assess({ ...base, goal: 'FAT_LOSS' });
    expect(a.bmrKcal).toBe(1749);
    expect(a.tdeeKcal).toBe(2711);
    expect(a.recommendedRatePct).toBe(0.5);
    expect(a.rateRangePct).toEqual({ min: 0.25, max: 1 });
    expect(a.rateCapped).toBe(false);
  });

  it('caps a request above 1%/week and explains why', () => {
    const a = assess({ ...base, goal: 'FAT_LOSS', requestedRatePct: 1.5 });
    expect(a.ratePct).toBe(1);
    expect(a.rateCapped).toBe(true);
    expect(a.capExplanation).toBe('MAX_RATE_FOR_SAFETY');
    expect(a.rationale).toContain('RATE_CAPPED');
  });

  it('gives a target date range from the band and the chosen rate', () => {
    // 8 kg at 0.4 kg/week (0.5%) = 140 days; at 0.8 kg/week = 70 days; at 0.2 kg/week = 280 days
    const a = assess({ ...base, goal: 'FAT_LOSS', targetWeightKg: 72 });
    expect(a.targetDateRange).toEqual({
      earliest: addDays('2026-11-02', 70),
      expected: addDays('2026-11-02', 140),
      latest: addDays('2026-11-02', 280),
    });
  });

  it('has no rate or dates for maintenance goals or targets in the wrong direction', () => {
    expect(assess({ ...base, goal: 'STRENGTH', targetWeightKg: 75 }).targetDateRange).toBeNull();
    expect(assess({ ...base, goal: 'STRENGTH' }).recommendedRatePct).toBeNull();
    expect(assess({ ...base, goal: 'FAT_LOSS', targetWeightKg: 85 }).targetDateRange).toBeNull();
    expect(
      assess({ ...base, goal: 'MUSCLE_GAIN', targetWeightKg: 84 }).targetDateRange,
    ).not.toBeNull();
  });

  it('adds days across month and year ends in UTC', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(() => addDays('02/11/2026', 1)).toThrow();
  });
});
