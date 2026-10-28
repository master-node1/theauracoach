import { permissionsFor, type Permission } from '@aura/contracts';
import { adminSections } from '@aura/ui-tokens';
import type { Session } from './session';

export type AdminSection = (typeof adminSections)[number];

const prefix = (type: string) => (p: Permission) => p.startsWith(`${type}:`);

/** Which permissions show each admin section; the API still checks every call (auth LLD §4). */
const SECTION_ACCESS: Record<AdminSection, (p: Permission) => boolean> = {
  Dashboard: () => true,
  Exercises: prefix('exercise'),
  Foods: prefix('food'),
  Recipes: prefix('recipe'),
  Templates: prefix('template'),
  Prompts: prefix('prompt'),
  Policies: prefix('policy'),
  'Review queue': prefix('review'),
  Feedback: (p) => p === 'feedback:read',
  Users: (p) => p === 'user:support_read',
  'Usage and cost': (p) => p === 'usage:read',
  'Audit log': (p) => p === 'audit:read',
  Roles: (p) => p === 'role:grant',
  Operations: (p) => p === 'event:replay',
};

/**
 * Sections that have pages, with the permission each page needs. The others arrive with TAC-33
 * (content and review queues) and TAC-34 (AI operations) and show as "soon" until then.
 */
export const ADMIN_PAGES: Partial<Record<AdminSection, { href: string; permission?: Permission }>> =
  {
    Dashboard: { href: '/admin' },
    Users: { href: '/admin/users', permission: 'user:support_read' },
    'Usage and cost': { href: '/admin/usage', permission: 'usage:read' },
    'Audit log': { href: '/admin/audit', permission: 'audit:read' },
    Roles: { href: '/admin/roles', permission: 'role:grant' },
    Operations: { href: '/admin/operations', permission: 'event:replay' },
  };

/** Admin sections the session's roles can use, in sidebar order. Empty for non-staff. */
export function visibleAdminSections(groups: readonly string[]): AdminSection[] {
  const granted = [...permissionsFor(groups)];
  if (granted.length === 0) return [];
  return adminSections.filter((s) => granted.some(SECTION_ACCESS[s]));
}

export function hasPermission(groups: readonly string[], permission: Permission): boolean {
  return permissionsFor(groups).has(permission);
}

/** The permission an /admin page needs, from the longest matching page path; null for none. */
export function adminPathPermission(pathname: string): Permission | null {
  let best: { href: string; permission?: Permission } | undefined;
  for (const page of Object.values(ADMIN_PAGES)) {
    if (!page || page.href === '/admin') continue;
    const matches = pathname === page.href || pathname.startsWith(`${page.href}/`);
    if (matches && (!best || page.href.length > best.href.length)) best = page;
  }
  return best?.permission ?? null;
}

/**
 * Whether the session may open the admin console: staff (any admin permission) who signed in with
 * MFA. Mirrors the API's AdminMfaGuard, so people see a helpful page instead of failing calls.
 * With `pathname`, also checks the permission that page needs.
 */
export function adminAccess(
  session: Pick<Session, 'groups' | 'mfa'>,
  pathname?: string,
): 'ok' | 'forbidden' | 'mfa_required' {
  if (permissionsFor(session.groups).size === 0) return 'forbidden';
  if (!session.mfa) return 'mfa_required';
  const needed = pathname ? adminPathPermission(pathname) : null;
  if (needed && !hasPermission(session.groups, needed)) return 'forbidden';
  return 'ok';
}
