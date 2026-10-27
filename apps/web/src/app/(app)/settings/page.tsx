import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CURRENT_POLICY_VERSION } from '@aura/api-client';
import { SignOutButton, SignOutEverywhereButton } from '@/components/SignOutButton';
import { currentFlags, currentMe, currentSession, serverApi } from '@/lib/server-session';
import { SettingsForm } from './SettingsForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('settings') };
}
export const dynamic = 'force-dynamic';

const APP_VERSION = '0.1';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; delete?: string }>;
}) {
  const query = await searchParams;
  const { error } = query;
  const flags = await currentFlags();
  if (!flags.settings_v1) notFound();
  const t = await getTranslations();
  const session = await currentSession();
  const me = await currentMe();
  const api = session ? serverApi(session) : null;
  const consents = api ? await api.consents().catch(() => null) : null;
  // `?delete=confirm`: back from the fresh sign-in that deleting the account needs.
  const privacy =
    api && flags.privacy_v1
      ? {
          latestExport: (await api.exports().catch(() => []))[0] ?? null,
          resumeDelete: query.delete === 'confirm',
        }
      : null;

  return (
    <>
      <header>
        <h1 className="page-title">{t('common.settings')}</h1>
      </header>
      {me && consents ? (
        <SettingsForm
          me={me}
          consents={consents}
          policyVersion={CURRENT_POLICY_VERSION}
          privacy={privacy}
        />
      ) : (
        <section className="card warning" role="alert">
          <h2>{t('settings.loadFailed')}</h2>
          <p>{t('common.refreshHint')}</p>
        </section>
      )}
      {error === 'sign-out-all' ? (
        <section className="card warning" role="alert">
          <p>We couldn&apos;t sign out your other devices. Try again in a moment.</p>
        </section>
      ) : null}
      <section className="settings-group" aria-labelledby="about-heading">
        <h2 id="about-heading">{t('settings.about')}</h2>
        <div className="settings-list">
          <div className="settings-row">
            <SignOutButton />
          </div>
          <div className="settings-row">
            <SignOutEverywhereButton />
          </div>
        </div>
        <p className="fine-print settings-footer">
          {t('settings.footer', { version: APP_VERSION })}
          <br />
          {t('settings.disclaimer')}
        </p>
      </section>
    </>
  );
}
