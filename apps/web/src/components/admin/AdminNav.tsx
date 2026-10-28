'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface AdminNavItem {
  label: string;
  /** Null for sections that have no page yet. */
  href: string | null;
}

/** The admin rail's section links, marking the current one. */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const current = (href: string) =>
    href === '/admin'
      ? pathname === '/admin'
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <>
      {items.map((item) =>
        item.href ? (
          <Link
            key={item.label}
            href={item.href}
            className="nav-link"
            aria-current={current(item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ) : (
          <span key={item.label} className="nav-link muted" aria-disabled="true">
            {item.label}
            <span className="badge">Soon</span>
          </span>
        ),
      )}
    </>
  );
}
