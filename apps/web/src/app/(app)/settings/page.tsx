import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CURRENT_POLICY_VERSION } from '@aura/api-client';
import { SignOutButton } from '@/components/SignOutButton';
import { currentFlags, currentMe, currentSession, serverApi } from '@/lib/server-session';
import { SettingsForm } from './SettingsForm';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!(await currentFlags()).settings_v1) notFound();
  const session = await currentSession();
  const me = await currentMe();
  const consents = session
    ? await serverApi(session)
        .consents()
        .catch(() => null)
    : null;

  return (
    <>
      <header>
        <h1 className="page-title">Settings</h1>
      </header>
      {me && consents ? (
        <SettingsForm me={me} consents={consents} policyVersion={CURRENT_POLICY_VERSION} />
      ) : (
        <section className="card warning" role="alert">
          <h2>We couldn&apos;t load your settings</h2>
          <p>Check your connection and refresh the page.</p>
        </section>
      )}
      <section className="settings-group" aria-labelledby="about-heading">
        <h2 id="about-heading">About</h2>
        <div className="settings-list">
          <div className="settings-row">
            <SignOutButton />
          </div>
        </div>
        <p className="fine-print settings-footer">
          AuraCoach 0.1 beta · Data stored in India (Mumbai)
          <br />
          Fitness guidance only, not medical advice.
        </p>
      </section>
    </>
  );
}
