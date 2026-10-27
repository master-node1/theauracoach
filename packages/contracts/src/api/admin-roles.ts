import { z } from 'zod';
import { GRANTABLE_ROLES, type GrantableRole, type Permission } from '../auth/permissions';

/** `RoleGrantInput` for POST /v1/admin/roles. The target is named by user id or by email. */
export const roleGrantSchema = z
  .strictObject({
    userId: z.uuid().optional(),
    email: z.email().max(254).optional(),
    role: z.enum(GRANTABLE_ROLES),
  })
  .refine((b) => (b.userId ? !b.email : !!b.email), 'Give exactly one of userId or email');
export type RoleGrantInput = z.infer<typeof roleGrantSchema>;

export interface RoleGrant {
  userId: string;
  email: string;
  role: GrantableRole;
  grantedBy: string | null;
  grantedAt: string;
}

export interface RoleDefinition {
  id: GrantableRole;
  description: string;
  permissions: Permission[];
}

/** GET /v1/admin/roles: the grantable roles and every current grant. */
export interface RoleListResponse {
  roles: RoleDefinition[];
  grants: RoleGrant[];
}
