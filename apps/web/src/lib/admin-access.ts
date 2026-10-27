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
};

/** Admin sections the session's roles can use, in sidebar order. Empty for non-staff. */
export function visibleAdminSections(groups: readonly string[]): AdminSection[] {
  const granted = [...permissionsFor(groups)];
  if (granted.length === 0) return [];
  return adminSections.filter((s) => granted.some(SECTION_ACCESS[s]));
}

/**
 * Whether the session may open the admin console: staff (any admin permission) who signed in with
 * MFA. Mirrors the API's AdminMfaGuard, so people see a helpful page instead of failing calls.
 */
export function adminAccess(
  session: Pick<Session, 'groups' | 'mfa'>,
): 'ok' | 'forbidden' | 'mfa_required' {
  if (permissionsFor(session.groups).size === 0) return 'forbidden';
  return session.mfa ? 'ok' : 'mfa_required';
}
