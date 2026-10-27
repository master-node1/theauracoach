import Decimal from 'decimal.js';

/**
 * All nutrition maths runs on decimal.js so sums of many entries never drift (TAC-12 AC 3).
 * Engines return Decimal values; callers round only when they display or store a target.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

/** Anything a caller may hand us as a number: plain numbers, numeric strings (Prisma Decimal JSON) or Decimals. */
export type Numeric = number | string | Decimal;

export function dec(value: Numeric): Decimal {
  return new Dec(value);
}

export function sum(values: Iterable<Numeric>): Decimal {
  let total = new Dec(0);
  for (const v of values) total = total.plus(v);
  return total;
}

/** Display rounding, half-up, to `places` decimals. Use only at the edge (UI, stored targets). */
export function round(value: Numeric, places = 0): number {
  return new Dec(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toNumber();
}

export function clamp(value: Decimal, min: Numeric, max: Numeric): Decimal {
  return Dec.min(Dec.max(value, min), max);
}
