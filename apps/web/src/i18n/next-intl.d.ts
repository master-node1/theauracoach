import type { AppLocale, Messages } from '@aura/i18n';

/** Typed keys: t('settings.tyo') fails type-checking. */
declare module 'next-intl' {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}
