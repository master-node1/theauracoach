import type { Metadata } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('forbidden');
  return { title: t('title') };
}

export default function ForbiddenPage() {
  const t = useTranslations('forbidden');
  return (
    <main className="welcome">
      <div className="welcome-card">
        <h1>{t('heading')}</h1>
        <p>{t('body')}</p>
        <Link className="button" href="/">
          {t('back')}
        </Link>
      </div>
    </main>
  );
}
