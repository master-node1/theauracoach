import type { WebConfig } from './config';
import {
  FLOW_COOKIE,
  FLOW_MAX_AGE,
  REFRESH_COOKIE,
  SIGNED_OUT_COOKIE,
  SIGNED_OUT_MAX_AGE,
  clearCookie,
  parseCookies,
  serializeCookie,
} from './cookies';
import { isSameOrigin, safeReturnTo } from './csrf';
import {
  authorizeUrl,
  exchangeCode,
  logoutUrl,
  pkceChallenge,
  randomToken,
  revokeToken,
  type IdTokenVerifier,
} from './oidc';
import { seal, unseal } from './seal';
import {
  clearSessionCookies,
  readRefreshToken,
  resolveSession,
  sessionCookies,
  sessionFromTokens,
} from './session';

/**
 * The BFF's auth routes (ADR-006) as plain Request -> Response functions so they can be unit
 * tested; app/api/auth/* only wires them up.
 */

export interface AuthDeps {
  config: WebConfig;
  verifyIdToken: IdTokenVerifier;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Flow {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

function redirect(location: string, setCookies: string[] = [], status = 302): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(null, { status, headers });
}

function problem(status: number, code: string, title: string, setCookies: string[] = []): Response {
  const headers = new Headers({
    'content-type': 'application/problem+json',
    'cache-control': 'no-store',
  });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify({ type: 'about:blank', title, status, code }), {
    status,
    headers,
  });
}

function signInError(config: WebConfig, error: string, setCookies: string[] = []): Response {
  return redirect(`${config.appUrl}/auth/sign-in?error=${encodeURIComponent(error)}`, setCookies);
}

/** GET /api/auth/login?returnTo=/path: starts Authorization Code + PKCE. */
export async function login(request: Request, deps: AuthDeps): Promise<Response> {
  const { config } = deps;
  const flow: Flow = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(48),
    returnTo: safeReturnTo(new URL(request.url).searchParams.get('returnTo')),
  };
  const sealed = await seal({ ...flow }, config.sessionSecret, FLOW_MAX_AGE);
  const target = authorizeUrl(config, {
    state: flow.state,
    nonce: flow.nonce,
    codeChallenge: await pkceChallenge(flow.verifier),
  });
  return redirect(target, [serializeCookie(FLOW_COOKIE, sealed, FLOW_MAX_AGE)]);
}

/** GET /api/auth/callback?code&state: checks state and nonce, then sets the session cookies. */
export async function callback(request: Request, deps: AuthDeps): Promise<Response> {
  const { config } = deps;
  const params = new URL(request.url).searchParams;
  const cookies = parseCookies(request.headers.get('cookie'));
  const flow = await unseal<Flow>(cookies.get(FLOW_COOKIE), config.sessionSecret);
  const clearFlow = clearCookie(FLOW_COOKIE);

  if (params.get('error')) return signInError(config, 'provider', [clearFlow]);
  const code = params.get('code');
  const state = params.get('state');
  if (!flow || !code || !state || state !== flow.state) {
    return signInError(config, 'state', [clearFlow]);
  }
  try {
    const tokens = await exchangeCode(config, { code, codeVerifier: flow.verifier }, deps.fetch);
    if (!tokens.id_token || !tokens.refresh_token)
      return signInError(config, 'tokens', [clearFlow]);
    const claims = await deps.verifyIdToken(tokens.id_token, flow.nonce);
    const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
    const session = sessionFromTokens(tokens, claims, now);
    const setCookies = await sessionCookies(config, session, tokens.refresh_token);
    return redirect(`${config.appUrl}${safeReturnTo(flow.returnTo)}`, [
      clearFlow,
      clearCookie(SIGNED_OUT_COOKIE),
      ...setCookies,
    ]);
  } catch {
    return signInError(config, 'tokens', [clearFlow]);
  }
}

/** POST /api/auth/refresh: forces a refresh. 204 with new cookies, or 401. */
export async function refresh(request: Request, deps: AuthDeps): Promise<Response> {
  if (!isSameOrigin(request, deps.config))
    return problem(403, 'CSRF', 'Cross-origin request refused');
  const state = await resolveSession(deps.config, request.headers.get('cookie'), deps, {
    forceRefresh: true,
  });
  if (state.kind !== 'refreshed') {
    const clear = state.kind === 'none' ? state.setCookies : [];
    return problem(401, 'UNAUTHENTICATED', 'Sign in again', clear);
  }
  const headers = new Headers({ 'cache-control': 'no-store' });
  for (const c of state.setCookies) headers.append('set-cookie', c);
  return new Response(null, { status: 204, headers });
}

/** POST /api/auth/logout: revokes the refresh token, clears cookies, ends the provider session. */
export async function logout(request: Request, deps: AuthDeps): Promise<Response> {
  const { config } = deps;
  if (!isSameOrigin(request, config)) return problem(403, 'CSRF', 'Cross-origin request refused');
  const cookies = parseCookies(request.headers.get('cookie'));
  const refreshToken = await readRefreshToken(config, cookies.get(REFRESH_COOKIE));
  if (refreshToken) await revokeToken(config, refreshToken, deps.fetch);
  // 303 so the browser follows with a GET.
  return redirect(
    logoutUrl(config),
    [...clearSessionCookies(), serializeCookie(SIGNED_OUT_COOKIE, '1', SIGNED_OUT_MAX_AGE)],
    303,
  );
}
