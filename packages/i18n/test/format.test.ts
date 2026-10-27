import { describe, expect, it } from 'vitest';
import {
  cmToFeetInches,
  dayPeriod,
  feetInchesToCm,
  formatDate,
  formatEnergy,
  formatHeight,
  formatInr,
  formatLength,
  formatNumber,
  formatRange,
  formatTime,
  formatVolume,
  formatWeight,
  kgToLb,
  lbToKg,
  localDay,
  localHour,
} from '../src';

const locale = 'en-IN';
/** Swap no-break spaces for plain ones so expectations stay readable. */
const plain = (s: string) => s.replace(/\u00A0|\u202F/g, ' ');

describe('unit conversion', () => {
  it('converts kg and lb both ways without drift', () => {
    expect(kgToLb(1)).toBeCloseTo(2.20462, 5);
    expect(lbToKg(kgToLb(72.5))).toBeCloseTo(72.5, 10);
  });

  it('rounds height to whole inches and carries 12 inches into a foot', () => {
    expect(cmToFeetInches(175)).toEqual({ feet: 5, inches: 9 });
    expect(cmToFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
    expect(cmToFeetInches(182.5)).toEqual({ feet: 6, inches: 0 });
    expect(feetInchesToCm(5, 9)).toBeCloseTo(175.26, 2);
  });
});

describe('unit formatting follows the preference', () => {
  it('formats weight in kg or lb with one decimal', () => {
    expect(plain(formatWeight(72.5, { locale, unitSystem: 'METRIC' }))).toBe('72.5 kg');
    expect(plain(formatWeight(72.5, { locale, unitSystem: 'IMPERIAL' }))).toBe('159.8 lb');
    expect(plain(formatWeight(80, { locale, unitSystem: 'METRIC' }))).toBe('80 kg');
  });

  it('joins number and unit with a no-break space', () => {
    expect(formatWeight(70, { locale, unitSystem: 'METRIC' })).toBe('70\u00A0kg');
  });

  it('formats height, length and water', () => {
    expect(plain(formatHeight(175, { locale, unitSystem: 'METRIC' }))).toBe('175 cm');
    expect(plain(formatHeight(175, { locale, unitSystem: 'IMPERIAL' }))).toBe('5 ft 9 in');
    expect(plain(formatLength(82, { locale, unitSystem: 'IMPERIAL' }))).toBe('32.3 in');
    expect(plain(formatVolume(750, { locale, unitSystem: 'METRIC' }))).toBe('750 ml');
    expect(plain(formatVolume(2500, { locale, unitSystem: 'METRIC' }))).toBe('2.5 L');
    expect(plain(formatVolume(750, { locale, unitSystem: 'IMPERIAL' }))).toBe('25 fl oz');
  });

  it('marks estimates with ≈', () => {
    expect(plain(formatEnergy(452.4, { locale, estimate: true }))).toBe('≈ 452 kcal');
    expect(plain(formatNumber(12, { locale, estimate: true }))).toBe('≈ 12');
    expect(plain(formatRange(1800, 2000, 'kcal', { locale, estimate: true }))).toBe(
      '≈ 1,800–2,000 kcal',
    );
  });

  it('groups large numbers the Indian way', () => {
    expect(formatNumber(1234567, { locale })).toBe('12,34,567');
  });
});

describe('rupees', () => {
  it('uses ₹ with lakh grouping and drops paise for whole amounts', () => {
    expect(formatInr(123456, { locale })).toBe('₹1,23,456');
    expect(formatInr(99.5, { locale })).toBe('₹99.50');
    expect(formatInr(0, { locale })).toBe('₹0');
  });
});

describe('dates in the user time zone', () => {
  // 20:00 UTC on 26 October is 01:30 on 27 October in India.
  const lateUtc = new Date('2026-10-26T20:00:00Z');

  it('puts a log on the user calendar day, not the server one', () => {
    expect(localDay(lateUtc, 'Asia/Kolkata')).toBe('2026-10-27');
    expect(localDay(lateUtc, 'Europe/London')).toBe('2026-10-26');
    expect(localHour(lateUtc, 'Asia/Kolkata')).toBe(1);
  });

  it('follows daylight saving time where the zone has it', () => {
    // US clocks go back on 1 November 2026: 12:00 UTC is 08:00 EDT before, 07:00 EST after.
    expect(localHour(new Date('2026-10-31T12:00:00Z'), 'America/New_York')).toBe(8);
    expect(localHour(new Date('2026-11-02T12:00:00Z'), 'America/New_York')).toBe(7);
    // India has no DST: the same instant a week apart is the same local hour.
    expect(localHour(new Date('2026-10-31T12:00:00Z'), 'Asia/Kolkata')).toBe(17);
    expect(localHour(new Date('2026-11-02T12:00:00Z'), 'Asia/Kolkata')).toBe(17);
    // Sydney moves to daylight time on 4 October 2026 (UTC+11).
    expect(localHour(new Date('2026-10-27T00:00:00Z'), 'Australia/Sydney')).toBe(11);
  });

  it('formats dates and times for en-IN', () => {
    const at = new Date('2026-10-27T02:00:00Z');
    expect(formatDate(at, { locale, timeZone: 'Asia/Kolkata', style: 'full' })).toBe(
      'Tuesday, 27 October',
    );
    expect(formatDate(at, { locale, timeZone: 'Asia/Kolkata', style: 'medium' })).toBe(
      '27 Oct 2026',
    );
    expect(plain(formatTime(at, { locale, timeZone: 'Asia/Kolkata' }))).toBe('7:30 am');
  });

  it('picks the greeting from the local hour', () => {
    expect(dayPeriod(new Date('2026-10-27T02:00:00Z'), 'Asia/Kolkata')).toBe('morning');
    expect(dayPeriod(new Date('2026-10-27T08:00:00Z'), 'Asia/Kolkata')).toBe('afternoon');
    expect(dayPeriod(new Date('2026-10-27T13:00:00Z'), 'Asia/Kolkata')).toBe('evening');
    expect(dayPeriod(new Date('2026-10-27T13:00:00Z'), 'Europe/London')).toBe('afternoon');
  });
});
