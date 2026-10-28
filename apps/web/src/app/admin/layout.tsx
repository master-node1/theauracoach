import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { adminAccess, visibleAdminSections } from '@/lib/admin-access';
import { currentSession } from '@/lib/server-session';
import MfaRequiredPage from '../forbidden/mfa/page';
import ForbiddenPage from '../forbidden/page';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin · AuraCoach' },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in?returnTo=/admin');
  // proxy.ts already answers 403; this keeps the layout safe on its own.
  const access = adminAccess(session);
  if (access === 'forbidden') return <ForbiddenPage />;
  if (access === 'mfa_required') return <MfaRequiredPage />;
  const sections = visibleAdminSections(session.groups);
  return (
    <div className="admin-shell">
      <nav aria-label="Admin" className="admin-sidebar">
        <div className="brand">
          <Logo />
          <span>Admin</span>
        </div>
        {sections.map((section, i) => (
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
