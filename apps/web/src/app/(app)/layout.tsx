import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Logo } from '@/components/Logo';
import { PendingDeletion } from '@/components/privacy/PendingDeletion';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeSync } from '@/components/ThemeSync';
import { isStaff } from '@/lib/session';
import { currentFlags, currentMe, currentSession, serverApi } from '@/lib/server-session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const [me, flags] = await Promise.all([currentMe(), currentFlags()]);
  const settings = flags.settings_v1;
  const name = me?.displayName ?? session.email;
  if (me?.status === 'PENDING_DELETION') {
    // Everything else answers 423 now, so show only what still works: restore, export, sign out.
    const latestExport =
      (
        await serverApi(session)
          .exports()
          .catch(() => [])
      )[0] ?? null;
    return (
      <div className="shell">
        <ThemeSync theme={me.preferences.theme} />
        <main className="content">
          <div className="content-inner">
            <Logo />
            <PendingDeletion
              deletionDueAt={me.deletionDueAt}
              timeZone={me.timezone}
              latestExport={latestExport}
            />
          </div>
        </main>
      </div>
    );
  }
  return (
    <div className="shell">
      {me && <ThemeSync theme={me.preferences.theme} />}
      <AppNav
        email={session.email}
        name={name}
        staff={isStaff(session.groups)}
        settings={settings}
      />
      <main className="content">
        <div className="content-inner">
          <div className="mobile-header">
            <Logo />
            {settings ? (
              <Link href="/settings" className="avatar" aria-label="Settings">
                {(name[0] ?? '?').toUpperCase()}
              </Link>
            ) : (
              <SignOutButton />
            )}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
