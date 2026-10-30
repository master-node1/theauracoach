import { useTranslations } from 'next-intl';

/** A plain form POST, so sign out works without JavaScript and carries an Origin header. */
export function SignOutButton() {
  const t = useTranslations('common');
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit" className="link-button">
        {t('signOut')}
      </button>
    </form>
  );
}

/**
 * Ends every session of the user, on all devices (TAC-8); this browser lands on sign-in. Other
 * devices are signed out at their next request.
 */
export function SignOutEverywhereButton() {
  const t = useTranslations('settings');
  return (
    <form action="/api/auth/logout-everywhere" method="post">
      <button type="submit" className="link-button">
        {t('signOutEverywhere')}
      </button>
    </form>
  );
}
