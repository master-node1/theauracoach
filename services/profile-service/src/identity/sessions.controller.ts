import { Controller, Headers, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import {
  CurrentUser,
  ProblemException,
  SESSION_REVOCATIONS,
  type AuthenticatedUser,
  type SessionRevocations,
} from '@aura/service-kit';
import {
  IDENTITY_PROVIDER,
  IdentityProviderError,
  type IdentityProvider,
} from './identity-provider';

@Controller('v1/me/sessions')
export class SessionsController {
  constructor(
    @Inject(SESSION_REVOCATIONS) private readonly revocations: SessionRevocations,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  /**
   * Sign out of all devices (PRD A2): every access token issued until now stops working in every
   * service, and Cognito stops the refresh tokens so no device can get new ones.
   */
  @Post('revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAll(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('authorization') authorization: string,
  ): Promise<void> {
    await this.revocations.revokeAll(user.userId, Math.floor(Date.now() / 1000));
    try {
      await this.identity.globalSignOut(authorization.slice('Bearer '.length));
    } catch (err) {
      // The cut-off already holds, but refresh tokens still work until GlobalSignOut succeeds;
      // the app tells the user to try again. A token Cognito already revoked means it is done.
      if (err instanceof IdentityProviderError && err.type === 'NotAuthorizedException') return;
      throw new ProblemException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'IDENTITY_UNAVAILABLE',
        'Could not sign out other devices, try again',
      );
    }
  }
}
