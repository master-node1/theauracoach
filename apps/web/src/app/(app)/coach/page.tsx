import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('coach') };
}

export default function CoachPage() {
  const t = useTranslations();
  return (
    <>
      <h1 className="page-title">{t('nav.coach')}</h1>
      <section className="card">
        <h2>{t('common.comingSoon')}</h2>
        <p>{t('coach.placeholder')}</p>
      </section>
    </>
  );
}
