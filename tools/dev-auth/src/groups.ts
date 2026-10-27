import { timingSafeEqual } from 'node:crypto';
import type { OAuthResult } from './oauth';

/**
 * Group memberships, the local stand-in for Cognito groups. profile-service writes them through the
 * admin endpoints in server.ts when it grants or revokes a role; tokens read them at sign-in and on
 * every refresh, so a revoked role disappears at the next refresh, as with Cognito.
 */
export class GroupStore {
  private readonly groups = new Map<string, Set<string>>();

  list(sub: string): string[] {
    return [...(this.groups.get(sub) ?? [])].sort();
  }

  add(sub: string, group: string): void {
    const set = this.groups.get(sub) ?? new Set<string>();
    set.add(group);
    this.groups.set(sub, set);
  }

  remove(sub: string, group: string): void {
    this.groups.get(sub)?.delete(group);
  }
}

/** Group names follow Cognito's rules closely enough for local use. */
export const GROUP_NAME = /^[a-z][a-z0-9_]{1,39}$/;

const ADMIN_PATH = /^\/admin\/users\/([0-9a-f-]{36})\/groups(?:\/([^/]+))?$/;

function keyMatches(given: string | undefined, expected: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `GET /admin/users/{sub}/groups`, `PUT|DELETE /admin/users/{sub}/groups/{group}`: Cognito's
 * AdminListGroupsForUser, AdminAddUserToGroup and AdminRemoveUserFromGroup for local use.
 * Callers send the shared key in `x-dev-auth-admin-key`. Returns null for other paths.
 */
export function handleGroupAdmin(
  store: GroupStore,
  adminKey: string,
  req: { method: string; path: string; key: string | undefined },
): OAuthResult | null {
  const match = ADMIN_PATH.exec(req.path);
  if (!match) return null;
  if (!keyMatches(req.key, adminKey)) return { status: 401 };
  const sub = match[1]!.toLowerCase();
  const group = match[2];
  if (req.method === 'GET' && !group) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups: store.list(sub) }),
    };
  }
  if (group && GROUP_NAME.test(group) && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (req.method === 'PUT') store.add(sub, group);
    else store.remove(sub, group);
    return { status: 204 };
  }
  return { status: 400 };
}
