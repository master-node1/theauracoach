import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('train') };
}

export default function TrainPage() {
  const t = useTranslations();
  return (
    <>
      <h1 className="page-title">{t('nav.train')}</h1>
      <section className="card">
        <h2>{t('common.comingSoon')}</h2>
        <p>{t('train.placeholder')}</p>
      </section>
    </>
  );
}
