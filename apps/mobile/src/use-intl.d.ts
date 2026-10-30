import type { AppLocale, Messages } from '@aura/i18n';

/** Typed keys: t('settings.tyo') fails type-checking. */
declare module 'use-intl' {
  interface AppConfig {
    Locale: AppLocale;
    Messages: Messages;
  }
}
