import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { WebConfig } from './config';

/** OAuth 2.0 / OIDC calls against Cognito's hosted endpoints (or dev-auth, which mimics them). */

export interface TokenResponse {
  access_token: string;
  id_token?: string;
  /** Cognito returns a refresh token on the code grant; on refresh only when rotation is on. */
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export class OidcError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function redirectUri(config: WebConfig): string {
  return `${config.appUrl}/api/auth/callback`;
}

/**
 * `reauth` makes the provider ask for credentials even with a live session (`prompt=login`,
 * `max_age=0`), so the new tokens carry a fresh `auth_time` (needed to delete an account).
 */
export function authorizeUrl(
  config: WebConfig,
  p: {
    state: string;
    nonce: string;
    codeChallenge: string;
    provider?: string;
    reauth?: boolean;
  },
): string {
  const url = new URL(`${config.oidc.domainUrl}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.oidc.clientId,
    redirect_uri: redirectUri(config),
    scope: config.oidc.scopes,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: 'S256',
    // Skips the hosted page and goes straight to Google or Apple.
    ...(p.provider ? { identity_provider: p.provider } : {}),
    ...(p.reauth ? { prompt: 'login', max_age: '0' } : {}),
  }).toString();
  return url.toString();
}

export function logoutUrl(config: WebConfig): string {
  const url = new URL(`${config.oidc.domainUrl}/logout`);
  url.search = new URLSearchParams({
    client_id: config.oidc.clientId,
    logout_uri: `${config.appUrl}/auth/sign-in`,
  }).toString();
  return url.toString();
}

function clientAuth(config: WebConfig, form: URLSearchParams): HeadersInit {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (config.oidc.clientSecret) {
    const basic = Buffer.from(`${config.oidc.clientId}:${config.oidc.clientSecret}`);
    headers.authorization = `Basic ${basic.toString('base64')}`;
  } else {
    form.set('client_id', config.oidc.clientId);
  }
  return headers;
}

async function tokenRequest(
  config: WebConfig,
  form: URLSearchParams,
  doFetch: typeof fetch,
): Promise<TokenResponse> {
  const headers = clientAuth(config, form);
  const res = await doFetch(`${config.oidc.domainUrl}/oauth2/token`, {
    method: 'POST',
    headers,
    body: form,
    cache: 'no-store',
  });
  if (!res.ok) throw new OidcError(`token endpoint returned ${res.status}`, res.status);
  const body = (await res.json()) as TokenResponse;
  if (!body.access_token) throw new OidcError('token endpoint returned no access token');
  return body;
}

export function exchangeCode(
  config: WebConfig,
  p: { code: string; codeVerifier: string },
  doFetch: typeof fetch = fetch,
): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: p.code,
    redirect_uri: redirectUri(config),
    code_verifier: p.codeVerifier,
  });
  return tokenRequest(config, form, doFetch);
}

export function refreshTokens(
  config: WebConfig,
  refreshToken: string,
  doFetch: typeof fetch = fetch,
): Promise<TokenResponse> {
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return tokenRequest(config, form, doFetch);
}

/** Best effort: sign out must still clear the cookies when the provider is unreachable. */
export async function revokeToken(
  config: WebConfig,
  refreshToken: string,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const form = new URLSearchParams({ token: refreshToken });
  const headers = clientAuth(config, form);
  try {
    await doFetch(`${config.oidc.domainUrl}/oauth2/revoke`, {
      method: 'POST',
      headers,
      body: form,
    });
  } catch {
    // Ignored: the cookies are cleared either way and the token expires on its own.
  }
}

export interface IdClaims extends JWTPayload {
  sub: string;
  email?: string;
  nonce?: string;
  'cognito:groups'?: string[];
}

export type IdTokenVerifier = (idToken: string, nonce?: string) => Promise<IdClaims>;

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Verifies the ID token's signature, issuer, audience and (on sign-in) nonce. */
export function idTokenVerifier(config: WebConfig): IdTokenVerifier {
  let jwks = jwksByIssuer.get(config.oidc.issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${config.oidc.issuer}/.well-known/jwks.json`));
    jwksByIssuer.set(config.oidc.issuer, jwks);
  }
  const keySet = jwks;
  return async (idToken, nonce) => {
    const { payload } = await jwtVerify(idToken, keySet, {
      issuer: config.oidc.issuer,
      audience: config.oidc.clientId,
      algorithms: ['RS256'],
    });
    if (payload.token_use !== undefined && payload.token_use !== 'id') {
      throw new OidcError('not an ID token');
    }
    if (nonce !== undefined && payload.nonce !== nonce) throw new OidcError('nonce mismatch');
    if (typeof payload.sub !== 'string') throw new OidcError('ID token has no subject');
    return payload as IdClaims;
  };
}
