import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ServiceName } from '@aura/contracts';
import type { Request } from 'express';
import { ProblemException } from '../http/problem';
import { SERVICE_KIT_CONFIG } from '../tokens';
import type { BaseConfig } from '../config/config';
import {
  INTERNAL_CALLERS,
  PUBLIC_ROUTE,
  type AuthenticatedUser,
  type ServiceCaller,
} from './decorators';
import { INTERNAL_TOKEN_HEADER, verifyServiceToken } from './service-token';
import { UserTokenVerifier } from './user-token.verifier';

type AuthedRequest = Request & { user?: AuthenticatedUser; serviceCaller?: ServiceCaller };

const unauthenticated = () =>
  new ProblemException(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentication required');

/**
 * Global guard. Every route is authenticated unless marked @Public():
 * routes marked @InternalOnly(...) need a service token from a listed caller,
 * every other route needs a Cognito access token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: UserTokenVerifier,
    @Inject(SERVICE_KIT_CONFIG) private readonly config: BaseConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const callers = this.reflector.getAllAndOverride<ServiceName[] | undefined>(
      INTERNAL_CALLERS,
      targets,
    );

    if (callers) {
      const token = req.headers[INTERNAL_TOKEN_HEADER];
      if (typeof token !== 'string') throw unauthenticated();
      let caller: ServiceCaller;
      try {
        caller = await verifyServiceToken(
          token,
          this.config.INTERNAL_TOKEN_SECRET,
          this.config.SERVICE_NAME,
        );
      } catch {
        throw unauthenticated();
      }
      if (!callers.includes(caller.service)) {
        throw new ProblemException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Caller not allowed');
      }
      req.serviceCaller = caller;
      return true;
    }

    // Public API routes never accept service tokens, and internal routes never accept user tokens.
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();
    try {
      req.user = await this.verifier.verify(header.slice('Bearer '.length));
    } catch {
      throw unauthenticated();
    }
    return true;
  }
}
