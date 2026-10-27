import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FlagKey } from '@aura/contracts';
import type { AuthenticatedUser } from '../auth/decorators';
import { ProblemException } from '../http/problem';
import { FeatureFlags } from './feature-flags';

export const REQUIRED_FLAGS = 'aura:required-flags';

/** The route exists only while every listed flag is on for the caller; otherwise it is a 404. */
export const RequireFlag = (...keys: FlagKey[]) => SetMetadata(REQUIRED_FLAGS, keys);

/** Global guard, after AuthGuard so a percentage rollout can use the caller's user id. */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlags,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const keys = this.reflector.getAllAndMerge<FlagKey[]>(REQUIRED_FLAGS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (keys.length === 0) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    const values = this.flags.evaluate(user?.userId);
    if (keys.every((k) => values[k])) return true;
    throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
  }
}
