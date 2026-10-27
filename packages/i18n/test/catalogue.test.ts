import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';
import {
  PSEUDO_LOCALE,
  enIN,
  findBannedPhrases,
  messagesFor,
  pseudoMessage,
  resolveLocale,
  type Messages,
} from '../src';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v] as [string, string]] : flatten(v, `${prefix}${k}.`),
  );
}

const SAMPLE_VALUES = {
  name: 'Priya',
  email: 'priya@example.com',
  version: '2026-10',
  period: 'morning',
  strong: (chunks: unknown) => chunks,
};

function render(locale: string, messages: Messages, key: string): string {
  const t = createTranslator({
    locale,
    messages,
    timeZone: 'Asia/Kolkata',
    // The default handler logs and returns the key; a broken message must fail the test.
    onError: (error) => {
      throw error;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (t as any).rich(key, SAMPLE_VALUES);
  return Array.isArray(value) ? value.join('') : String(value);
}

describe('en-IN catalogue', () => {
  const entries = flatten(enIN as unknown as Tree);

  it('fails on a broken message', () => {
    const broken = { ...enIN, common: { ...enIN.common, save: 'Save {' } } as Messages;
    expect(() => render('en-IN', broken, 'common.save')).toThrow();
  });

  it('has only valid ICU messages', () => {
    for (const [key] of entries) {
      expect(() => render('en-IN', enIN, key), key).not.toThrow();
    }
  });

  it('uses no banned phrase from the style guide', () => {
    const hits = entries.flatMap(([key, text]) =>
      findBannedPhrases(text).map((m) => `${key}: "${m.text}" (${m.id})`),
    );
    expect(hits).toEqual([]);
  });

  it('writes estimates with ≈, never ~ or "about"', () => {
    const tilde = entries.filter(([, text]) => /~\s?\d|\babout \d/.test(text));
    expect(tilde).toEqual([]);
  });
});

describe('pseudo-locale', () => {
  const pseudo = messagesFor(PSEUDO_LOCALE);

  it('has the same keys as en-IN and every message still formats', () => {
    const keys = flatten(enIN as unknown as Tree).map(([k]) => k);
    expect(flatten(pseudo as unknown as Tree).map(([k]) => k)).toEqual(keys);
    for (const key of keys) {
      expect(() => render(PSEUDO_LOCALE, pseudo, key), key).not.toThrow();
    }
  });

  it('accents and pads literal text but keeps arguments, tags and plural branches', () => {
    expect(pseudoMessage('Save')).toBe('[Šáṽé ~~]');
    expect(pseudoMessage('Hi {name}')).toBe('[Ĥî {name} ~]');
    expect(pseudoMessage('Signed in as <strong>{email}</strong>.')).toMatch(
      /^\[Šîĝñéð îñ áš <strong>\{email\}<\/strong>\. ~+\]$/,
    );
    const plural = pseudoMessage('{count, plural, one {# set} other {# sets}}');
    expect(plural).toBe('[{count, plural, one {# šéţ} other {# šéţš}} ~~~]');
    expect(pseudoMessage('%s · AuraCoach')).toMatch(/^\[%s · ÅûŕáÇöáçĥ ~+\]$/);
  });

  it('renders the Today greeting through its select branches', () => {
    expect(render('en-IN', enIN, 'today.greetingNamed')).toBe('Good morning, Priya');
    expect(render(PSEUDO_LOCALE, pseudo, 'today.greetingNamed')).toMatch(
      /^\[Ĝööð ɱöŕñîñĝ, Priya ~+\]$/,
    );
  });
});

describe('locale resolution', () => {
  it('prefers an exact supported locale, then the same language, then en-IN', () => {
    expect(resolveLocale(['en-IN'])).toBe('en-IN');
    expect(resolveLocale(['en-US', 'hi-IN'])).toBe('en-IN');
    expect(resolveLocale(['ta-IN'])).toBe('en-IN');
    expect(resolveLocale([null, undefined])).toBe('en-IN');
  });

  it('only offers the pseudo-locale when asked to', () => {
    expect(resolveLocale(['en-XA'])).toBe('en-IN');
    expect(resolveLocale(['en-XA'], { allowPseudo: true })).toBe('en-XA');
  });
});
