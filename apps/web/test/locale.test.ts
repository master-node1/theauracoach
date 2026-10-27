import { describe, expect, it } from 'vitest';
import { requestLocale } from '@/i18n/locale';

describe('request locale', () => {
  it('defaults to en-IN and ignores locales we do not offer', () => {
    expect(requestLocale(undefined, {})).toBe('en-IN');
    expect(requestLocale('fr-FR', {})).toBe('en-IN');
  });

  it('honours the en-XA pseudo-locale only when it is switched on', () => {
    expect(requestLocale('en-XA', {})).toBe('en-IN');
    expect(requestLocale('en-XA', { I18N_PSEUDO_LOCALE: 'true' })).toBe('en-XA');
  });
});
