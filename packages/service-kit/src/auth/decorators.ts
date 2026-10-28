import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ServiceName } from '@aura/contracts';

export const PUBLIC_ROUTE = 'aura:public';
export const INTERNAL_CALLERS = 'aura:internal-callers';

/** Route needs no token (health checks, public library reads). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Route under /internal/v1, callable only by the listed services with a service token. */
export const InternalOnly = (...callers: ServiceName[]) => SetMetadata(INTERNAL_CALLERS, callers);

export interface AuthenticatedUser {
  /**
   * The AuraCoach user id. It is the Cognito `sub` (a UUID), so every service can key its data
   * by it without asking profile-service (auth LLD §3).
   */
  userId: string;
  email?: string;
  groups: string[];
  /** Authentication methods from the token's `amr` claim; admin routes need MFA in it. */
  amr: string[];
  clientId: string;
  /** The access token's `iat`, epoch seconds; compared with the user's revocation cut-off. */
  issuedAt: number;
}

export interface ServiceCaller {
  service: ServiceName;
  /** Internal user id the caller acts for, when it acts for a user. */
  subUser?: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
});

export const CallingService = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ serviceCaller?: ServiceCaller }>().serviceCaller;
});
