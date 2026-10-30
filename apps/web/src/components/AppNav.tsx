'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { tabs } from '@aura/ui-tokens';
import { Icon, Logo } from './Logo';
import { SignOutButton } from './SignOutButton';

const SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z';

export function hrefFor(id: string): string {
  return id === 'today' ? '/' : `/${id}`;
}

export function AppNav({
  email,
  name,
  staff,
  settings,
}: {
  email: string;
  name: string;
  staff: boolean;
  settings: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations();
  return (
    <nav aria-label={t('nav.main')} className="rail">
      <div className="brand">
        <Logo />
        <span className="label">{t('common.appName')}</span>
      </div>
      {tabs.map((tab) => {
        const href = hrefFor(tab.id);
        const current = href === '/' ? pathname === '/' : pathname.startsWith(href);
        const label = t(`nav.${tab.id}`);
        return (
          <Link
            key={tab.id}
            href={href}
            className="nav-link"
            aria-current={current ? 'page' : undefined}
            title={label}
          >
            <Icon path={tab.icon} />
            <span className="label">{label}</span>
          </Link>
        );
      })}
      <div className="rail-spacer" />
      {staff && (
        <Link href="/admin" className="nav-link muted rail-extra" title={t('nav.adminConsole')}>
          <Icon path={SHIELD} />
          <span className="label">{t('nav.adminConsole')}</span>
        </Link>
      )}
      <div className="account rail-extra">
        {settings ? (
          <Link
            href="/settings"
            className="account-link"
            title={t('common.settings')}
            aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
          >
            <span className="avatar" aria-hidden="true">
              {(name[0] ?? '?').toUpperCase()}
            </span>
            <span className="account-email" data-testid="account-email">
              {email}
            </span>
            <span className="visually-hidden">{t('common.settings')}</span>
          </Link>
        ) : (
          <>
            <span className="avatar" aria-hidden="true">
              {(name[0] ?? '?').toUpperCase()}
            </span>
            <span className="account-email" data-testid="account-email">
              {email}
            </span>
          </>
        )}
        <SignOutButton />
      </div>
    </nav>
  );
}
