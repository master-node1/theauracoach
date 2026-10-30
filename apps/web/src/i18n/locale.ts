import { resolveLocale, type AppLocale } from '@aura/i18n';

/** Optional locale override; until Hindi ships (P2) only the en-XA pseudo-locale uses it. */
export const LOCALE_COOKIE = 'aura-locale';

/**
 * The locale for a request: the cookie when it names a locale we offer, otherwise en-IN. The
 * en-XA pseudo-locale is only honoured with I18N_PSEUDO_LOCALE=true (local runs and CI).
 */
export function requestLocale(
  cookie: string | undefined,
  env: Record<string, string | undefined> = process.env,
): AppLocale {
  return resolveLocale([cookie], { allowPseudo: env.I18N_PSEUDO_LOCALE === 'true' });
}
