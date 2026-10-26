import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeSync } from '@/components/ThemeSync';
import { featureEnabled } from '@/lib/features';
import { isStaff } from '@/lib/session';
import { currentMe, currentSession } from '@/lib/server-session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const me = await currentMe();
  const settings = featureEnabled('SETTINGS_V1');
  const name = me?.displayName ?? session.email;
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
