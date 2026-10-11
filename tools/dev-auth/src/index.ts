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
    clientId?: string;
    expiresIn?: string;
    tokenUse?: 'access' | 'id';
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
      };
      if (input.email) claims.email = input.email;
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setSubject(input.sub ?? randomUUID())
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime(input.expiresIn ?? '1h')
        .sign(privateKey);
    },
  };
}
