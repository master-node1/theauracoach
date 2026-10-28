import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { AdminNav } from '@/components/admin/AdminNav';
import { ADMIN_PAGES, adminAccess, hasPermission, visibleAdminSections } from '@/lib/admin-access';
import { currentSession } from '@/lib/server-session';
import MfaRequiredPage from '../forbidden/mfa/page';
import ForbiddenPage from '../forbidden/page';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin · AuraCoach' },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in?returnTo=/admin');
  // proxy.ts already answers 403 (per page too); this keeps the layout safe on its own.
  const access = adminAccess(session);
  if (access === 'forbidden') return <ForbiddenPage />;
  if (access === 'mfa_required') return <MfaRequiredPage />;
  const items = visibleAdminSections(session.groups).map((label) => {
    const page = ADMIN_PAGES[label];
    const usable = page && (!page.permission || hasPermission(session.groups, page.permission));
    return { label, href: usable ? page.href : null };
  });
  return (
    <div className="admin-shell">
      <nav aria-label="Admin" className="admin-sidebar">
        <div className="brand">
          <Logo />
          <span>Admin</span>
        </div>
        <AdminNav items={items} />
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
        <div className="content-inner admin-content">{children}</div>
      </main>
    </div>
  );
}
