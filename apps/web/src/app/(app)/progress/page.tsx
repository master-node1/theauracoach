import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('progress') };
}

export default function ProgressPage() {
  const t = useTranslations();
  return (
    <>
      <h1 className="page-title">{t('nav.progress')}</h1>
      <section className="card">
        <h2>{t('common.comingSoon')}</h2>
        <p>{t('progress.placeholder')}</p>
      </section>
    </>
  );
}
