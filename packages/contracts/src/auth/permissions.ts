/**
 * Roles are owned by profile-service and mirrored to Cognito groups (security architecture §3).
 * Permission names follow the catalogue in docs/modules/authentication/LLD.md §4.
 * A user's own data needs no permission: ownership is checked in each service.
 */
export const ROLES = [
  'user',
  'owner',
  'content_editor',
  'content_reviewer',
  'nutrition_reviewer',
  'safety_reviewer',
  'support',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles an admin can grant. `user` is implicit for every account and never stored as a grant. */
export const GRANTABLE_ROLES = ROLES.filter((r): r is Exclude<Role, 'user'> => r !== 'user');
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export const ROLE_DESCRIPTIONS: Record<GrantableRole, string> = {
  owner: 'Everything, including AI prompts, policies and role grants',
  content_editor: 'Drafts exercises, templates, foods and recipes',
  content_reviewer: 'Reviews and publishes exercises and workout templates',
  nutrition_reviewer: 'Reviews and publishes foods and recipes',
  safety_reviewer: 'Works the safety review queue and user feedback',
  support: 'Reads a masked support view of a user and their feedback',
};

const CONTENT = ['exercise', 'template', 'food', 'recipe', 'prompt', 'policy'] as const;
const CONTENT_ACTIONS = ['write', 'review', 'publish'] as const;
type ContentPermission = `${(typeof CONTENT)[number]}:${(typeof CONTENT_ACTIONS)[number]}`;

export const PERMISSIONS = [
  ...CONTENT.flatMap((c) => CONTENT_ACTIONS.map((a) => `${c}:${a}` as ContentPermission)),
  'review:read',
  'review:resolve',
  'feedback:read',
  'usage:read',
  'audit:read',
  'role:grant',
  'user:support_read',
  'flag:write',
  'event:replay',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const contentPermissions = (types: string[], actions: string[]) =>
  PERMISSIONS.filter((p) => {
    const [type, action] = p.split(':');
    return types.includes(type!) && actions.includes(action!);
  });

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  user: [],
  owner: [...PERMISSIONS],
  content_editor: contentPermissions(['exercise', 'template', 'food', 'recipe'], ['write']),
  content_reviewer: contentPermissions(['exercise', 'template'], ['review', 'publish']),
  nutrition_reviewer: contentPermissions(['food', 'recipe'], ['review', 'publish']),
  safety_reviewer: ['review:read', 'review:resolve', 'feedback:read'],
  support: ['user:support_read', 'feedback:read'],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    if (!isRole(role)) continue;
    for (const p of ROLE_PERMISSIONS[role]) result.add(p);
  }
  return result;
}

/**
 * Authentication methods that count as multi-factor in a token's `amr` claim (RFC 8176).
 * Admin routes need one of them (TC-SEC-3).
 */
export const MFA_METHODS = ['mfa', 'otp', 'hwk', 'swk'] as const;

export function hasMfa(amr: readonly string[] | undefined): boolean {
  return !!amr?.some((m) => (MFA_METHODS as readonly string[]).includes(m));
}
