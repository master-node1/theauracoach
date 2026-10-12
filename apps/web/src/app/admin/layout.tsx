import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminSections } from '@aura/ui-tokens';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { isStaff } from '@/lib/session';
import { currentSession } from '@/lib/server-session';
import ForbiddenPage from '../forbidden/page';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin · AuraCoach' },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in?returnTo=/admin');
  // proxy.ts already answers 403 for non-staff; this keeps the layout safe on its own.
  if (!isStaff(session.groups)) return <ForbiddenPage />;
  return (
    <div className="admin-shell">
      <nav aria-label="Admin" className="admin-sidebar">
        <div className="brand">
          <Logo />
          <span>Admin</span>
        </div>
        {adminSections.map((section, i) => (
          <span key={section} className="nav-link" aria-current={i === 0 ? 'page' : undefined}>
            {section}
          </span>
        ))}
        <div className="rail-spacer" />
        <a className="nav-link muted" href="/">
          Back to app
        </a>
        <div className="account">
          <span className="account-email">{session.email}</span>
          <SignOutButton />
        </div>
      </nav>
      <main className="content">
        <div className="content-inner">{children}</div>
      </main>
    </div>
  );
}
