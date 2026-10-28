import {
  confirmSignUpSchema,
  createIdentityClient,
  emailOnlySchema,
  IdentityError,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type IdentityClient,
  type IdentityTokens,
} from '@aura/api-client';
import type { z } from 'zod';
import { problem, redirect, type AuthDeps } from './auth-handlers';
import type { WebConfig } from './config';
import {
  PENDING_COOKIE,
  PENDING_MAX_AGE,
  REFRESH_COOKIE,
  SIGNED_OUT_COOKIE,
  SIGNED_OUT_MAX_AGE,
  clearCookie,
  parseCookies,
  serializeCookie,
} from './cookies';
import { isSameOrigin, safeReturnTo } from './csrf';
import { logoutUrl, revokeToken } from './oidc';
import { seal, unseal } from './seal';
import {
  clearSessionCookies,
  readRefreshToken,
  resolveSession,
  sessionCookies,
  sessionFromTokens,
} from './session';

/**
 * The BFF's email routes (TAC-8): sign up, verify, resend, sign in, forgot, reset and sign out
 * of all devices. The browser posts JSON; tokens only ever land in the HttpOnly session cookies.
 * Answers are `{redirect}` on success or a problem whose `code` the page turns into words.
 */

export interface EmailAuthDeps extends AuthDeps {
  identity?: IdentityClient;
}

/** Between sign-up and verify (with Cognito's sign-up session) or forgot and reset. */
interface Pending {
  email: string;
  session?: string;
}

function identityClient(deps: EmailAuthDeps): IdentityClient {
  return (
    deps.identity ??
    createIdentityClient({
      endpoint: deps.config.identityEndpoint,
      clientId: deps.config.oidc.clientId,
      ...(deps.config.oidc.clientSecret ? { clientSecret: deps.config.oidc.clientSecret } : {}),
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    })
  );
}

function ok(body: unknown, setCookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function identityProblem(err: unknown): Response {
  const code = err instanceof IdentityError ? err.code : 'Unavailable';
  const status =
    code === 'Unavailable'
      ? 503
      : code === 'LimitExceeded' || code === 'TooManyRequests'
        ? 429
        : code === 'UsernameExists'
          ? 409
          : 400;
  return problem(status, code, 'The request could not be completed');
}

async function pendingCookie(config: WebConfig, pending: Pending): Promise<string> {
  const sealed = await seal({ ...pending }, config.sessionSecret, PENDING_MAX_AGE);
  return serializeCookie(PENDING_COOKIE, sealed, PENDING_MAX_AGE);
}

export async function readPending(
  config: WebConfig,
  cookieHeader: string | null,
): Promise<Pending | null> {
  const p = await unseal<Pending>(
    parseCookies(cookieHeader).get(PENDING_COOKIE),
    config.sessionSecret,
  );
  return p && typeof p.email === 'string'
    ? { email: p.email, ...(p.session ? { session: p.session } : {}) }
    : null;
}

/**
 * Shared front of every email route: same-origin, rate limit, JSON body that passes `schema`.
 * Returns the parsed body or the response to send instead.
 */
async function accept<S extends z.ZodType>(
  request: Request,
  deps: EmailAuthDeps,
  schema: S,
): Promise<{ input: z.infer<S> } | { response: Response }> {
  if (!isSameOrigin(request, deps.config)) {
    return { response: problem(403, 'CSRF', 'Cross-origin request refused') };
  }
  const limited = deps.limiter?.check(request, deps.config);
  if (limited) return { response: limited };
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const code = field === 'password' ? 'InvalidPassword' : 'InvalidParameter';
    return { response: problem(422, code, 'Check the details and try again') };
  }
  return { input: parsed.data };
}

/** Signs the browser in with tokens from the identity API, like the OAuth callback does. */
async function signedIn(
  deps: EmailAuthDeps,
  tokens: IdentityTokens,
  location: string,
  extraCookies: string[] = [],
): Promise<Response> {
  const claims = await deps.verifyIdToken(tokens.idToken);
  const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
  const session = sessionFromTokens(
    {
      access_token: tokens.accessToken,
      id_token: tokens.idToken,
      expires_in: tokens.expiresIn,
      token_type: 'Bearer',
    },
    claims,
    now,
  );
  const cookies = await sessionCookies(deps.config, session, tokens.refreshToken);
  return ok({ redirect: location }, [...extraCookies, clearCookie(SIGNED_OUT_COOKIE), ...cookies]);
}

/** POST /api/auth/sign-up {email, password}: registers and sends a code; next is /auth/verify. */
export async function signUp(request: Request, deps: EmailAuthDeps): Promise<Response> {
  const accepted = await accept(request, deps, signUpSchema);
  if ('response' in accepted) return accepted.response;
  const { email, password } = accepted.input;
  try {
    const out = await identityClient(deps).signUp(email, password);
    const cookie = await pendingCookie(deps.config, {
      email,
      ...(out.session ? { session: out.session } : {}),
    });
    return ok({ redirect: '/auth/verify' }, [cookie]);
  } catch (err) {
    return identityProblem(err);
  }
}

/**
 * POST /api/auth/verify {email, code}: confirms the email. With the sign-up session from this
 * browser it signs straight in; otherwise (another browser, or the session expired) it sends the
 * user to sign in with their password.
 */
export async function verify(request: Request, deps: EmailAuthDeps): Promise<Response> {
  const accepted = await accept(request, deps, confirmSignUpSchema);
  if ('response' in accepted) return accepted.response;
  const { email, code } = accepted.input;
  const pending = await readPending(deps.config, request.headers.get('cookie'));
  const session = pending?.email === email ? pending.session : undefined;
  const identity = identityClient(deps);
  let next: { session?: string };
  try {
    next = await identity.confirmSignUp(email, code, session);
  } catch (err) {
    return identityProblem(err);
  }
  const clearPending = clearCookie(PENDING_COOKIE);
  if (next.session) {
    try {
      const tokens = await identity.signInAfterConfirm(email, next.session);
      return await signedIn(deps, tokens, '/', [clearPending]);
    } catch {
      // Fall through: the account is confirmed, so the password sign-in works.
    }
  }
  return ok({ redirect: '/auth/sign-in?verified=1' }, [clearPending]);
}

/** POST /api/auth/resend {email}: a new sign-up code (the old one stops working). */
export async function resend(request: Request, deps: EmailAuthDeps): Promise<Response> {
  const accepted = await accept(request, deps, emailOnlySchema);
  if ('response' in accepted) return accepted.response;
  try {
    await identityClient(deps).resendCode(accepted.input.email);
    return ok({});
  } catch (err) {
    return identityProblem(err);
  }
}

/** POST /api/auth/sign-in {email, password, returnTo?}: email and password on our own screen. */
export async function signIn(request: Request, deps: EmailAuthDeps): Promise<Response> {
  const accepted = await accept(request, deps, signInSchema);
  if ('response' in accepted) return accepted.response;
  const { email, password, returnTo } = accepted.input;
  try {
    const tokens = await identityClient(deps).signInWithPassword(email, password);
    return await signedIn(deps, tokens, safeReturnTo(returnTo));
  } catch (err) {
    // UserNotConfirmed comes back as its code; the page then offers to verify the email.
    return identityProblem(err);
  }
}

/**
 * POST /api/auth/forgot {email}: emails a reset code. Always the same answer for unknown emails,
 * so the form cannot be used to find out who has an account.
 */
export async function forgot(request: Request, deps: EmailAuthDeps): Promise<Response> {
  const accepted = await accept(request, deps, emailOnlySchema);
  if ('response' in accepted) return accepted.response;
  const { email } = accepted.input;
  try {
    await identityClient(deps).forgotPassword(email);
  } catch (err) {
    if (
      !(err instanceof IdentityError) ||
      !['NotAuthorized', 'InvalidParameter'].includes(err.code)
    ) {
      return identityProblem(err);
    }
  }
  return ok({ redirect: '/auth/reset' }, [await pendingCookie(deps.config, { email })]);
}

/** POST /api/auth/reset {email, code, password}: sets the new password; next is sign in. */
export async function reset(request: Request, deps: EmailAuthDeps): Promise<Response> {
  const accepted = await accept(request, deps, resetPasswordSchema);
  if ('response' in accepted) return accepted.response;
  const { email, code, password } = accepted.input;
  try {
    await identityClient(deps).confirmForgotPassword(email, code, password);
    return ok({ redirect: '/auth/sign-in?reset=1' }, [clearCookie(PENDING_COOKIE)]);
  } catch (err) {
    return identityProblem(err);
  }
}

/**
 * POST /api/auth/logout-everywhere (a form post from Settings): asks the API to revoke every
 * session of the user, then signs this browser out like /api/auth/logout.
 */
export async function logoutEverywhere(request: Request, deps: EmailAuthDeps): Promise<Response> {
  const { config } = deps;
  if (!isSameOrigin(request, config)) return problem(403, 'CSRF', 'Cross-origin request refused');
  const cookieHeader = request.headers.get('cookie');
  const state = await resolveSession(config, cookieHeader, deps);
  if (state.kind === 'none') {
    return redirect(`${config.appUrl}/auth/sign-in`, state.setCookies, 303);
  }
  let revoked = false;
  try {
    const res = await (deps.fetch ?? fetch)(`${config.apiBaseUrl}/v1/me/sessions/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${state.session.accessToken}` },
      cache: 'no-store',
    });
    revoked = res.status === 204;
  } catch {
    revoked = false;
  }
  if (!revoked) {
    const keep = state.kind === 'refreshed' ? state.setCookies : [];
    return redirect(`${config.appUrl}/settings?error=sign-out-all`, keep, 303);
  }
  // GlobalSignOut already revoked it; revoking again keeps dev-auth and Cognito in step.
  const refreshToken = await readRefreshToken(
    config,
    parseCookies(cookieHeader).get(REFRESH_COOKIE),
  );
  if (refreshToken) await revokeToken(config, refreshToken, deps.fetch);
  return redirect(
    logoutUrl(config),
    [...clearSessionCookies(), serializeCookie(SIGNED_OUT_COOKIE, '1', SIGNED_OUT_MAX_AGE)],
    303,
  );
}
