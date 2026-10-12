import { redirect } from 'next/navigation';
import { AppNav } from '@/components/AppNav';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { isStaff } from '@/lib/session';
import { currentSession } from '@/lib/server-session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  return (
    <div className="shell">
      <AppNav email={session.email} staff={isStaff(session.groups)} />
      <main className="content">
        <div className="content-inner">
          <div className="mobile-header">
            <Logo />
            <SignOutButton />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
