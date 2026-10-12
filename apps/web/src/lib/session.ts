import { ROLES } from '@aura/contracts';
import type { WebConfig } from './config';
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SIGNED_OUT_COOKIE,
  clearCookie,
  parseCookies,
  serializeCookie,
} from './cookies';
import { refreshTokens, type IdClaims, type IdTokenVerifier, type TokenResponse } from './oidc';
import { seal, unseal } from './seal';

/** What the session cookie holds. Only the server can open it. */
export interface Session {
  accessToken: string;
  /** Access token expiry, epoch seconds. */
  expiresAt: number;
  sub: string;
  email: string;
  groups: string[];
}

/** Refresh when less than this many seconds of the access token remain (TAC-2). */
export const REFRESH_LEEWAY_SECONDS = 60;

const STAFF_ROLES = new Set<string>(ROLES.filter((r) => r !== 'user'));

/** The admin console is for staff: any role other than `user` (contracts ROLES). */
export function isStaff(groups: readonly string[]): boolean {
  return groups.some((g) => STAFF_ROLES.has(g));
}

export function sessionFromTokens(
  tokens: TokenResponse,
  claims: IdClaims,
  nowSeconds: number,
): Session {
  return {
    accessToken: tokens.access_token,
    expiresAt: nowSeconds + tokens.expires_in,
    sub: claims.sub,
    email: claims.email ?? '',
    groups: claims['cognito:groups'] ?? [],
  };
}

export async function sessionCookies(
  config: WebConfig,
  session: Session,
  refreshToken: string | undefined,
): Promise<string[]> {
  const cookies = [
    serializeCookie(
      SESSION_COOKIE,
      await seal({ ...session }, config.sessionSecret, SESSION_MAX_AGE),
      SESSION_MAX_AGE,
    ),
  ];
  if (refreshToken) {
    const sealed = await seal({ rt: refreshToken }, config.sessionSecret, SESSION_MAX_AGE);
    cookies.push(serializeCookie(REFRESH_COOKIE, sealed, SESSION_MAX_AGE));
  }
  return cookies;
}

export const clearSessionCookies = (): string[] => [
  clearCookie(SESSION_COOKIE),
  clearCookie(REFRESH_COOKIE),
];

export async function readSession(
  config: WebConfig,
  cookieValue: string | undefined,
): Promise<Session | null> {
  const payload = await unseal<Session & { iat?: number; exp?: number }>(
    cookieValue,
    config.sessionSecret,
  );
  if (!payload || typeof payload.accessToken !== 'string') return null;
  const { accessToken, expiresAt, sub, email, groups } = payload;
  return { accessToken, expiresAt, sub, email, groups: groups ?? [] };
}

export async function readRefreshToken(
  config: WebConfig,
  cookieValue: string | undefined,
): Promise<string | null> {
  const payload = await unseal<{ rt?: string }>(cookieValue, config.sessionSecret);
  return typeof payload?.rt === 'string' ? payload.rt : null;
}

export type SessionState =
  | { kind: 'valid'; session: Session }
  /** Refreshed: the caller must send `setCookies` and use `session` for this request. */
  | { kind: 'refreshed'; session: Session; sessionCookie: string; setCookies: string[] }
  /** Signed out or the refresh failed; `setCookies` clears whatever was left. */
  | { kind: 'none'; setCookies: string[] };

export interface ResolveDeps {
  verifyIdToken: IdTokenVerifier;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Reads the session from a Cookie header and refreshes it when the access token is about to
 * expire. Used by proxy.ts (pages and /api/v1) and the explicit refresh route.
 */
export async function resolveSession(
  config: WebConfig,
  cookieHeader: string | null,
  deps: ResolveDeps,
  options: { forceRefresh?: boolean } = {},
): Promise<SessionState> {
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const cookies = parseCookies(cookieHeader);
  const session = await readSession(config, cookies.get(SESSION_COOKIE));
  const hadCookies = cookies.has(SESSION_COOKIE) || cookies.has(REFRESH_COOKIE);
  // Signed out in this browser: a response that was in flight during sign out may have put a
  // session cookie back, so ignore (and clear) anything until the next sign-in.
  if (cookies.has(SIGNED_OUT_COOKIE)) {
    return { kind: 'none', setCookies: hadCookies ? clearSessionCookies() : [] };
  }
  if (session && !options.forceRefresh && session.expiresAt - now > REFRESH_LEEWAY_SECONDS) {
    return { kind: 'valid', session };
  }
  const none = (): SessionState => {
    // A refresh that fails inside the leeway window (say a parallel request won a race with a
    // rotating provider) leaves a token that still works; use it rather than signing out.
    if (session && session.expiresAt > now) return { kind: 'valid', session };
    return { kind: 'none', setCookies: hadCookies ? clearSessionCookies() : [] };
  };
  const refreshToken = await readRefreshToken(config, cookies.get(REFRESH_COOKIE));
  if (!refreshToken) return none();

  let tokens: TokenResponse;
  let claims: IdClaims;
  try {
    tokens = await refreshTokens(config, refreshToken, deps.fetch);
    if (tokens.id_token) {
      claims = await deps.verifyIdToken(tokens.id_token);
    } else if (session) {
      claims = { sub: session.sub, email: session.email, 'cognito:groups': session.groups };
    } else {
      return none();
    }
  } catch {
    return none();
  }
  if (session && claims.sub !== session.sub) return none();
  const refreshed = sessionFromTokens(tokens, claims, now);
  const setCookies = await sessionCookies(config, refreshed, tokens.refresh_token);
  const sessionCookie = (setCookies[0] as string).split(';')[0]!.slice(SESSION_COOKIE.length + 1);
  return { kind: 'refreshed', session: refreshed, sessionCookie, setCookies };
}
