/**
 * Number, unit, money and date formatting shared by both apps (docs/ux/content-style-guide.md §6).
 *
 * Values are stored metric (kg, cm, ml, kcal) and converted only for display, following the
 * user's unit preference. Numbers and their units are joined with a no-break space so they never
 * wrap apart, and estimates start with "≈".
 */

export type UnitSystem = 'METRIC' | 'IMPERIAL';

export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;
export const ML_PER_US_FL_OZ = 29.5735295625;

/** No-break space between a number and its unit. */
export const NBSP = '\u00A0';
export const ESTIMATE_SIGN = '≈';

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const cmToInches = (cm: number) => cm / CM_PER_INCH;
export const inchesToCm = (inches: number) => inches * CM_PER_INCH;

/** Whole feet and inches, rounding to the nearest inch (182.88 cm is 6 ft 0 in, not 5 ft 12 in). */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const total = Math.round(cmToInches(cm));
  return { feet: Math.floor(total / 12), inches: total % 12 };
}

export const feetInchesToCm = (feet: number, inches: number) => inchesToCm(feet * 12 + inches);

interface NumberOptions {
  locale: string;
  /** Prefix with "≈" because the value is an estimate. */
  estimate?: boolean;
  maximumFractionDigits?: number;
}

export function formatNumber(
  value: number,
  { locale, estimate = false, maximumFractionDigits = 0 }: NumberOptions,
): string {
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
  return estimate ? `${ESTIMATE_SIGN}${NBSP}${text}` : text;
}

function withUnit(value: number, unit: string, options: NumberOptions): string {
  return `${formatNumber(value, options)}${NBSP}${unit}`;
}

/** Body weight or load: "72.5 kg" or "159.8 lb". */
export function formatWeight(
  kg: number,
  options: NumberOptions & { unitSystem: UnitSystem },
): string {
  const opts = { maximumFractionDigits: 1, ...options };
  return options.unitSystem === 'IMPERIAL'
    ? withUnit(kgToLb(kg), 'lb', opts)
    : withUnit(kg, 'kg', opts);
}

/** Height: "175 cm" or "5 ft 9 in". */
export function formatHeight(
  cm: number,
  options: NumberOptions & { unitSystem: UnitSystem },
): string {
  if (options.unitSystem === 'METRIC') return withUnit(Math.round(cm), 'cm', options);
  const { feet, inches } = cmToFeetInches(cm);
  const prefix = options.estimate ? `${ESTIMATE_SIGN}${NBSP}` : '';
  return `${prefix}${feet}${NBSP}ft ${inches}${NBSP}in`;
}

/** Body measurements such as waist: "82 cm" or "32.3 in". */
export function formatLength(
  cm: number,
  options: NumberOptions & { unitSystem: UnitSystem },
): string {
  const opts = { maximumFractionDigits: 1, ...options };
  return options.unitSystem === 'IMPERIAL'
    ? withUnit(cmToInches(cm), 'in', opts)
    : withUnit(cm, 'cm', opts);
}

/** Water: "750 ml", "2.5 L" or "25 fl oz". */
export function formatVolume(
  ml: number,
  options: NumberOptions & { unitSystem: UnitSystem },
): string {
  if (options.unitSystem === 'IMPERIAL') return withUnit(ml / ML_PER_US_FL_OZ, 'fl oz', options);
  return ml >= 1000
    ? withUnit(ml / 1000, 'L', { maximumFractionDigits: 1, ...options })
    : withUnit(ml, 'ml', options);
}

/** Food energy is kcal in both systems: "≈ 450 kcal". */
export const formatEnergy = (kcal: number, options: NumberOptions) =>
  withUnit(kcal, 'kcal', options);

/** Macros and fibre are grams in both systems: "32 g". */
export const formatGrams = (grams: number, options: NumberOptions) => withUnit(grams, 'g', options);

/** A range with an en dash and one unit: "1,800–2,000 kcal". */
export function formatRange(
  min: number,
  max: number,
  unit: string,
  options: NumberOptions,
): string {
  const lo = formatNumber(min, { ...options, estimate: false });
  const hi = formatNumber(max, { ...options, estimate: false });
  const prefix = options.estimate ? `${ESTIMATE_SIGN}${NBSP}` : '';
  return `${prefix}${lo}–${hi}${NBSP}${unit}`;
}

/** Rupees with Indian grouping and no paise for whole amounts: "₹1,23,456" or "₹99.50". */
export function formatInr(amount: number, { locale }: { locale: string }): string {
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount);
}

export function formatPercent(fraction: number, { locale }: { locale: string }): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    fraction,
  );
}

/**
 * "a, b and c" in the locale's words. Engines without Intl.ListFormat (older Hermes) get the
 * English shape, which is the only shipped language today.
 */
export function formatList(items: readonly string[], { locale }: { locale: string }): string {
  if (typeof Intl.ListFormat === 'function') {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
  }
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

type DateStyle = 'full' | 'long' | 'medium' | 'short';

const DATE_STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  /** Tuesday, 27 October */
  full: { weekday: 'long', day: 'numeric', month: 'long' },
  /** 27 October 2026 */
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  /** 27 Oct 2026 */
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  /** 27/10/26 */
  short: { day: '2-digit', month: '2-digit', year: '2-digit' },
};

/** A date in the user's time zone, never the server's or device's. */
export function formatDate(
  date: Date,
  { locale, timeZone, style = 'long' }: { locale: string; timeZone: string; style?: DateStyle },
): string {
  return new Intl.DateTimeFormat(locale, { ...DATE_STYLES[style], timeZone }).format(date);
}

/** A clock time in the user's time zone: "7:30 am". */
export function formatTime(
  date: Date,
  { locale, timeZone }: { locale: string; timeZone: string },
): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(
    date,
  );
}

function parts(date: Date, timeZone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
}

/** The calendar day in the user's time zone as YYYY-MM-DD: the key logs are grouped by. */
export function localDay(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hour 0–23 in the user's time zone. */
export function localHour(date: Date, timeZone: string): number {
  return Number(parts(date, timeZone).hour);
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

/** Morning before 12:00, afternoon until 17:00, then evening (Today greeting). */
export function dayPeriod(date: Date, timeZone: string): DayPeriod {
  const hour = localHour(date, timeZone);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
