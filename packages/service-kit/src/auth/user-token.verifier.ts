import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthenticatedUser } from './decorators';

export interface UserTokenVerifierOptions {
  jwksUrl: string;
  issuer: string;
  clientIds: string[];
  /** Override the key source (tests). */
  keySource?: JWTVerifyGetKey;
}

export class InvalidTokenError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies Cognito access tokens: RS256 signature from the pool JWKS (cached by jose, refetched on
 * unknown kid), issuer, expiry, `token_use = access` and an allowed `client_id`.
 */
export class UserTokenVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly options: UserTokenVerifierOptions) {
    this.keys =
      options.keySource ??
      createRemoteJWKSet(new URL(options.jwksUrl), {
        cooldownDuration: 30_000,
        cacheMaxAge: 3_600_000,
      });
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.options.issuer,
        algorithms: ['RS256'],
        clockTolerance: 5,
      }));
    } catch {
      throw new InvalidTokenError('Token verification failed');
    }
    if (payload.token_use !== 'access') throw new InvalidTokenError('Not an access token');
    const clientId = payload.client_id;
    if (typeof clientId !== 'string' || !this.options.clientIds.includes(clientId)) {
      throw new InvalidTokenError('Client not allowed');
    }
    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      throw new InvalidTokenError('Subject is not a UUID');
    }
    const groups = payload['cognito:groups'];
    return {
      userId: payload.sub.toLowerCase(),
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
      clientId,
      issuedAt: typeof payload.iat === 'number' ? payload.iat : 0,
    };
  }
}
