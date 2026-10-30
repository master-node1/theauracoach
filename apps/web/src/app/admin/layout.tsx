import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { SignOutButton } from '@/components/SignOutButton';
import { AdminNav } from '@/components/admin/AdminNav';
import { ADMIN_PAGES, adminAccess, hasPermission, visibleAdminSections } from '@/lib/admin-access';
import { currentSession } from '@/lib/server-session';
import MfaRequiredPage from '../forbidden/mfa/page';
import ForbiddenPage from '../forbidden/page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: { default: t('admin.title'), template: t('meta.adminTitleTemplate') } };
}

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
  const t = await getTranslations('admin');
  return (
    <div className="admin-shell">
      <nav aria-label={t('nav')} className="admin-sidebar">
        <div className="brand">
          <Logo />
          <span>{t('title')}</span>
        </div>
        <AdminNav items={items} />
        <div className="rail-spacer" />
        <a className="nav-link muted" href="/">
          {t('backToApp')}
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
