import { enIN, type Messages } from './messages/en-IN';
import { pseudoLocalize } from './pseudo';

/** Locales users can get. Hindi follows in P2 (PRD NFR); add it here with its catalogue. */
export const SUPPORTED_LOCALES = ['en-IN'] as const;
export const DEFAULT_LOCALE = 'en-IN';
/**
 * Accented, ~40% longer English used to find hard-coded strings and truncation. Never offered to
 * users: the web turns it on with I18N_PSEUDO_LOCALE=true, mobile with EXPO_PUBLIC_LOCALE=en-XA.
 */
export const PSEUDO_LOCALE = 'en-XA';

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type AppLocale = SupportedLocale | typeof PSEUDO_LOCALE;

let pseudo: Messages | null = null;

export function messagesFor(locale: AppLocale): Messages {
  if (locale === PSEUDO_LOCALE) return (pseudo ??= pseudoLocalize(enIN));
  return enIN;
}

export function isAppLocale(value: string, allowPseudo = false): value is AppLocale {
  return (
    (SUPPORTED_LOCALES as readonly string[]).includes(value) ||
    (allowPseudo && value === PSEUDO_LOCALE)
  );
}

/**
 * Picks the first usable locale from preferred tags (a cookie, the profile's `locale`, the
 * device's list): an exact match, then the same language (any English becomes en-IN), then the
 * default.
 */
export function resolveLocale(
  preferred: readonly (string | null | undefined)[],
  { allowPseudo = false }: { allowPseudo?: boolean } = {},
): AppLocale {
  const tags = preferred.filter((t): t is string => !!t);
  for (const tag of tags) {
    if (isAppLocale(tag, allowPseudo)) return tag;
  }
  for (const tag of tags) {
    const language = tag.toLowerCase().split(/[-_]/)[0];
    const match = SUPPORTED_LOCALES.find((l) => l.toLowerCase().split('-')[0] === language);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
