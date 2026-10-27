import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('eat') };
}

export default function EatPage() {
  const t = useTranslations();
  return (
    <>
      <h1 className="page-title">{t('nav.eat')}</h1>
      <section className="card">
        <h2>{t('common.comingSoon')}</h2>
        <p>{t('eat.placeholder')}</p>
      </section>
    </>
  );
}
