import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('mfaRequired');
  return { title: t('title') };
}

/** Shown for /admin, and for admin API answers of 403 MFA_REQUIRED, to staff signed in without MFA. */
export default function MfaRequiredPage() {
  const t = useTranslations('mfaRequired');
  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>{t('heading')}</h1>
        <p>{t('body')}</p>
        <Link className="button" href="/auth/sign-in?returnTo=/admin">
          {t('signInAgain')}
        </Link>
        <p>
          <Link href="/">{t('back')}</Link>
        </p>
      </div>
    </main>
  );
}
