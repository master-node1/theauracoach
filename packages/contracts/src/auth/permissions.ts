/**
 * Roles are owned by profile-service and mirrored to Cognito groups (security architecture §3).
 * Permission names follow the catalogue in docs/modules/authentication/LLD.md §3.
 * A user's own data needs no permission: ownership is checked in each service.
 */
export const ROLES = [
  'user',
  'trainer',
  'nutritionist',
  'content_admin',
  'support',
  'admin',
] as const;
export type Role = (typeof ROLES)[number];

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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  user: [],
  trainer: ['exercise:write', 'exercise:review', 'template:write', 'template:review'],
  nutritionist: ['food:write', 'food:review', 'recipe:write', 'recipe:review'],
  content_admin: PERMISSIONS.filter((p) =>
    /^(exercise|template|food|recipe):/.test(p),
  ) as Permission[],
  support: ['user:support_read', 'feedback:read'],
  admin: [...PERMISSIONS],
};

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const result = new Set<Permission>();
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role as Role] ?? []) result.add(p);
  }
  return result;
}
