import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { ConsentPurpose } from '@aura/contracts';
import { ProblemException } from '../http/problem';
import type { AuthenticatedUser } from './decorators';

export const REQUIRED_CONSENT = 'aura:consent';
/** Provide a ConsentStateReader under this token in any service that uses @RequiresConsent. */
export const CONSENT_STATE = Symbol('CONSENT_STATE');

/**
 * Reads the service's local consent replica, built from ConsentChanged events, so the guard never
 * calls profile-service (auth LLD §1). Unknown users count as not consented.
 */
export interface ConsentStateReader {
  isGranted(userId: string, purpose: ConsentPurpose): Promise<boolean>;
}

/** The route needs the caller's current consent for `purpose`, e.g. AI_COACH (TC-PRV-4). */
export const RequiresConsent = (purpose: ConsentPurpose) => SetMetadata(REQUIRED_CONSENT, purpose);

/** Global guard, last in the chain: 403 CONSENT_REQUIRED (with `purpose`) when consent is missing. */
@Injectable()
export class ConsentGuard implements CanActivate {
  private reader?: ConsentStateReader;

  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const purpose = this.reflector.getAllAndOverride<ConsentPurpose | undefined>(REQUIRED_CONSENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!purpose) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) {
      throw new ProblemException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Caller not allowed');
    }
    // Resolved lazily: the reader lives in the service's own module, not in service-kit's.
    // A service that forgets to provide one fails closed with a 500.
    this.reader ??= this.moduleRef.get<ConsentStateReader>(CONSENT_STATE, { strict: false });
    if (await this.reader.isGranted(user.userId, purpose)) return true;
    throw new ProblemException(
      HttpStatus.FORBIDDEN,
      'CONSENT_REQUIRED',
      'This feature needs your consent',
      undefined,
      undefined,
      { purpose },
    );
  }
}
