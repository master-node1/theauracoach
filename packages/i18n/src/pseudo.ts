/**
 * Pseudo-localisation (en-XA): accents every letter, pads the text by about 40% and brackets it,
 * so untranslated strings stand out and layouts that cannot grow show up as clipped text.
 * ICU syntax is kept intact: argument names, plural/select keys, `#` and rich-text tags.
 */

const ACCENTS: Record<string, string> = {
  a: 'á',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'þ',
  q: 'ǫ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Þ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

const PLURAL_TYPES = new Set(['plural', 'selectordinal', 'select']);

function accent(text: string): string {
  return text.replace(/[A-Za-z]/g, (c) => ACCENTS[c] ?? c);
}

/** Index of the `}` that closes the `{` at `open`. */
function closing(message: string, open: number): number {
  let depth = 0;
  for (let i = open; i < message.length; i++) {
    if (message[i] === '{') depth++;
    else if (message[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`Unbalanced braces in message: ${message}`);
}

/** Accents the literal text of a message, recursing into plural/select branches. */
function transform(message: string, letters: { count: number }): string {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const c = message[i]!;
    if (c === '{') {
      const end = closing(message, i);
      out += argument(message.slice(i + 1, end), letters);
      i = end + 1;
    } else if (c === '<') {
      // Rich-text tag such as <strong> or </strong>: keep it.
      const end = message.indexOf('>', i);
      out += message.slice(i, end + 1);
      i = end + 1;
    } else if (c === "'" && (message[i + 1] === '{' || message[i + 1] === '}')) {
      // ICU quoted literal: copy up to the closing apostrophe untouched.
      const end = message.indexOf("'", i + 1);
      out += message.slice(i, end + 1);
      i = end + 1;
    } else if (c === '%' && message[i + 1] === 's') {
      // Page title template slot (Next.js metadata).
      out += '%s';
      i += 2;
    } else {
      if (/[A-Za-z]/.test(c)) letters.count++;
      out += c === '#' ? c : accent(c);
      i++;
    }
  }
  return out;
}

/** `name`, `name, number`, or `name, plural, one {...} other {...}`. */
function argument(body: string, letters: { count: number }): string {
  const parts = body.split(',');
  const type = parts[1]?.trim();
  if (!type || !PLURAL_TYPES.has(type)) return `{${body}}`;
  const head = `${parts[0]},${parts[1]},`;
  let rest = body.slice(head.length);
  let out = head;
  while (rest.length) {
    const open = rest.indexOf('{');
    if (open < 0) {
      out += rest;
      break;
    }
    const end = closing(rest, open);
    out += rest.slice(0, open) + '{' + transform(rest.slice(open + 1, end), letters) + '}';
    rest = rest.slice(end + 1);
  }
  return `{${out}}`;
}

export function pseudoMessage(message: string): string {
  const letters = { count: 0 };
  const body = transform(message, letters);
  const padding = Math.max(1, Math.ceil(letters.count * 0.4));
  return `[${body} ${'~'.repeat(padding)}]`;
}

type Tree = { readonly [key: string]: string | Tree };

/** Pseudo-localises every message in a catalogue, keeping its shape. */
export function pseudoLocalize<T extends Tree>(messages: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(messages)) {
    out[key] = typeof value === 'string' ? pseudoMessage(value) : pseudoLocalize(value);
  }
  return out as T;
}
