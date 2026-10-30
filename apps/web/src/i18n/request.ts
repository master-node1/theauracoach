import { messagesFor } from '@aura/i18n';
import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, requestLocale } from './locale';

/** next-intl request config (wired in next.config.ts): locale, catalogue and default time zone. */
export default getRequestConfig(async () => {
  const locale = requestLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    messages: messagesFor(locale),
    // Pages that show dates pass the user's own zone; this is only the fallback.
    timeZone: 'Asia/Kolkata',
  };
});
