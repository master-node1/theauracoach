import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  type Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasMfa, permissionsFor, type Permission } from '@aura/contracts';
import { ProblemException } from '../http/problem';
import type { AuthenticatedUser } from './decorators';
import { isAdminPath, routePath } from './routes';

export const REQUIRED_PERMISSIONS = 'aura:permissions';
export const ANY_PERMISSIONS = 'aura:any-permissions';

/** The caller needs every listed permission, mapped from the token's `cognito:groups` (auth LLD §4). */
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * The caller needs at least one listed permission, e.g. reading drafts, which editors
 * (`food:write`) and reviewers (`food:review`) both do. Combines with @Permissions.
 */
export const AnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS, permissions);

const forbidden = (title = 'You do not have permission for this action') =>
  new ProblemException(HttpStatus.FORBIDDEN, 'FORBIDDEN', title);

function userOf(context: ExecutionContext): AuthenticatedUser | undefined {
  return context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
}

function isAdminRoute(context: ExecutionContext): boolean {
  return isAdminPath(routePath(context.getClass() as Type<unknown>, context.getHandler()));
}

/**
 * Global guard after AuthGuard. On every /v1/admin route: callers without any staff permission get
 * 403 FORBIDDEN, staff whose token does not show MFA in `amr` get 403 MFA_REQUIRED (TC-SEC-3).
 * Routes elsewhere pass straight through.
 */
@Injectable()
export class AdminMfaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!isAdminRoute(context)) return true;
    const user = userOf(context);
    // A public or internal route under /v1/admin is a mistake; refuse it rather than open it.
    if (!user || permissionsFor(user.groups).size === 0) throw forbidden();
    if (!hasMfa(user.amr)) {
      throw new ProblemException(
        HttpStatus.FORBIDDEN,
        'MFA_REQUIRED',
        'Sign in again with multi-factor authentication to use the admin console',
      );
    }
    return true;
  }
}

/**
 * Global guard. Routes with @Permissions(...) need every listed permission, routes with
 * @AnyPermission(...) at least one. Admin routes that declare neither are refused, so a forgotten
 * decorator fails closed.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const all = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    const any = this.reflector.getAllAndOverride<Permission[] | undefined>(
      ANY_PERMISSIONS,
      targets,
    );
    if (!all?.length && !any?.length) {
      if (isAdminRoute(context)) throw forbidden();
      return true;
    }
    const user = userOf(context);
    if (!user) throw forbidden();
    const granted = permissionsFor(user.groups);
    if (all?.length && !all.every((p) => granted.has(p))) throw forbidden();
    if (any?.length && !any.some((p) => granted.has(p))) throw forbidden();
    return true;
  }
}
