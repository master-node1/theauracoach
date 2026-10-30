import { randomUUID } from 'node:crypto';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from 'jose';

export interface DevIssuer {
  issuer: string;
  jwks: JSONWebKeySet;
  keySource: JWTVerifyGetKey;
  mintAccessToken(input: {
    sub?: string;
    email?: string;
    groups?: string[];
    /** Authentication methods (RFC 8176), e.g. ['pwd', 'mfa'] after the staff MFA step. */
    amr?: string[];
    clientId?: string;
    expiresIn?: string;
    tokenUse?: 'access' | 'id';
    /** `auth_time`, epoch seconds: when the user last entered credentials. Defaults to now. */
    authTime?: number;
  }): Promise<string>;
  /** An OIDC id token: audience is the client, carries `email` and the login `nonce`. */
  mintIdToken(input: {
    sub: string;
    email: string;
    clientId: string;
    groups?: string[];
    nonce?: string;
    expiresIn?: string;
  }): Promise<string>;
}

export const DEV_CLIENT_ID = 'aura-dev-client';

/**
 * Issues RS256 tokens shaped like Cognito access tokens (token_use, client_id, cognito:groups),
 * plus the `email` claim our pre-token-generation trigger adds. Never used in deployed environments.
 */
export async function createDevIssuer(issuer = 'http://localhost:4100'): Promise<DevIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = randomUUID();
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  const jwks: JSONWebKeySet = { keys: [jwk] };
  return {
    issuer,
    jwks,
    keySource: createLocalJWKSet(jwks),
    async mintAccessToken(input) {
      const claims: Record<string, unknown> = {
        token_use: input.tokenUse ?? 'access',
        client_id: input.clientId ?? DEV_CLIENT_ID,
        'cognito:groups': input.groups ?? [],
        auth_time: input.authTime ?? Math.floor(Date.now() / 1000),
      };
      if (input.email) claims.email = input.email;
      if (input.amr) claims.amr = input.amr;
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setSubject(input.sub ?? randomUUID())
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime(input.expiresIn ?? '1h')
        .sign(privateKey);
    },
    async mintIdToken(input) {
      const claims: Record<string, unknown> = {
        token_use: 'id',
        email: input.email,
        email_verified: true,
        'cognito:groups': input.groups ?? [],
      };
      if (input.nonce) claims.nonce = input.nonce;
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setSubject(input.sub)
        .setIssuer(issuer)
        .setAudience(input.clientId)
        .setIssuedAt()
        .setExpirationTime(input.expiresIn ?? '1h')
        .sign(privateKey);
    },
  };
}

export {
  createOAuthHandlers,
  devUserId,
  DEV_MFA_CODE,
  type DevUser,
  type OAuthResult,
} from './oauth';
export { createIdentityHandlers, MAX_CODE_FAILURES, MAX_CODES_PER_WINDOW } from './identity';
export { GroupStore, GROUP_NAME, handleGroupTarget } from './groups';
