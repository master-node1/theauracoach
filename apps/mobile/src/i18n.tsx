// Hermes may lack Intl.PluralRules, which ICU plural messages need; this only installs when missing.
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
import { PSEUDO_LOCALE, messagesFor, resolveLocale, type AppLocale } from '@aura/i18n';
import { useCalendars, useLocales } from 'expo-localization';
import { useMemo } from 'react';
import { IntlProvider, useLocale } from 'use-intl';
import { appConfig } from './config';
import { useMe } from './preferences';

export { useTranslations } from 'use-intl';

/** The app's locale: the en-XA override, then the device's languages, then en-IN. */
export function pickLocale(override: string | null, deviceTags: readonly string[]): AppLocale {
  return resolveLocale([override, ...deviceTags], { allowPseudo: override === PSEUDO_LOCALE });
}

/**
 * Catalogue and formats for every screen. Dates use the signed-in user's saved time zone, falling
 * back to the device's before sign-in.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locales = useLocales();
  const calendars = useCalendars();
  const { me } = useMe();
  const locale = useMemo(
    () =>
      pickLocale(
        appConfig.locale,
        locales.map((l) => l.languageTag),
      ),
    [locales],
  );
  const timeZone = me?.timezone ?? calendars[0]?.timeZone ?? 'Asia/Kolkata';
  return (
    <IntlProvider locale={locale} messages={messagesFor(locale)} timeZone={timeZone}>
      {children}
    </IntlProvider>
  );
}

/** The active locale, for the @aura/i18n format helpers. */
export const useAppLocale = () => useLocale() as AppLocale;
