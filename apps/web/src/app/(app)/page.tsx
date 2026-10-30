import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { dayPeriod, formatDate } from '@aura/i18n';
import { currentMe } from '@/lib/server-session';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav');
  return { title: t('today') };
}
export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const me = await currentMe();
  const t = await getTranslations();
  const locale = await getLocale();
  const timeZone = me?.timezone ?? 'Asia/Kolkata';
  const now = new Date();
  const date = formatDate(now, { locale, timeZone, style: 'full' });
  const period = dayPeriod(now, timeZone);
  const name = me?.displayName ?? null;

  return (
    <>
      <header>
        <div className="page-date">{date}</div>
        <h1 className="page-title">
          {name ? t('today.greetingNamed', { period, name }) : t('today.greeting', { period })}
        </h1>
      </header>
      {me ? (
        <section className="card hero" aria-labelledby="today-empty">
          <h2 id="today-empty">{t('today.emptyTitle')}</h2>
          <p>
            {t.rich('today.emptyBody', {
              email: me.email,
              strong: (chunks) => <strong data-testid="me-email">{chunks}</strong>,
            })}
          </p>
        </section>
      ) : (
        <section className="card warning" role="alert">
          <h2>{t('today.profileFailed')}</h2>
          <p>{t('common.refreshHint')}</p>
        </section>
      )}
    </>
  );
}
