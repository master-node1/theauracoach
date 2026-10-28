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

const TARGET_PREFIX = 'AWSCognitoIdentityProviderService.';

const cognitoJson = (status: number, body: unknown): OAuthResult => ({
  status,
  headers: { 'content-type': 'application/x-amz-json-1.1' },
  body: JSON.stringify(body),
});

/**
 * Cognito's AdminAddUserToGroup, AdminRemoveUserFromGroup and AdminListGroupsForUser, spoken as
 * the `cognito-idp` JSON API (POST / with X-Amz-Target), so profile-service uses the same AWS SDK
 * client against dev-auth and Cognito. `Username` is the user's sub. Requests are not signed-checked:
 * dev-auth is local only. Returns null for any other target.
 */
export function handleGroupTarget(
  store: GroupStore,
  target: string | undefined,
  body: { Username?: unknown; GroupName?: unknown },
): OAuthResult | null {
  const action = target?.startsWith(TARGET_PREFIX) ? target.slice(TARGET_PREFIX.length) : '';
  if (
    !['AdminAddUserToGroup', 'AdminRemoveUserFromGroup', 'AdminListGroupsForUser'].includes(action)
  ) {
    return null;
  }
  const sub = typeof body.Username === 'string' ? body.Username.toLowerCase() : '';
  if (!sub) return cognitoJson(400, { __type: 'InvalidParameterException', message: 'Username' });
  if (action === 'AdminListGroupsForUser') {
    return cognitoJson(200, { Groups: store.list(sub).map((GroupName) => ({ GroupName })) });
  }
  const group = typeof body.GroupName === 'string' ? body.GroupName : '';
  if (!GROUP_NAME.test(group)) {
    return cognitoJson(400, { __type: 'InvalidParameterException', message: 'GroupName' });
  }
  if (action === 'AdminAddUserToGroup') store.add(sub, group);
  else store.remove(sub, group);
  return cognitoJson(200, {});
}
