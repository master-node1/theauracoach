import { createHash, randomBytes } from 'node:crypto';
import { GroupStore } from './groups';
import type { DevIssuer } from './index';

/** What an HTTP handler should send back; server.ts turns it into a response. */
export interface OAuthResult {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface OAuthOptions {
  clientIds?: string[];
  accessTokenTtlSeconds?: number;
  now?: () => number;
  /** Where group memberships live; server.ts shares it with the admin endpoints. */
  groups?: GroupStore;
  /** The one-time code the staff MFA step accepts. */
  mfaCode?: string;
}

/** The dev stand-in for a TOTP code. Local only; Cognito TOTP is used in deployed environments. */
export const DEV_MFA_CODE = '123456';

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce?: string;
  user: DevUser;
  expiresAt: number;
}

/** Signed in with an email; waiting for the MFA step. */
interface PendingMfa {
  form: URLSearchParams;
  user: DevUser;
  expiresAt: number;
}

interface DevUser {
  sub: string;
  email: string;
  /** How the user signed in: ['pwd'], or ['pwd', 'mfa'] after the MFA step. */
  amr: string[];
}

const CODE_TTL_MS = 5 * 60_000;

/**
 * The same person always gets the same id, so signing in again with an email finds the same
 * profile. Shaped as a UUID because services reject any other subject.
 */
export function devUserId(email: string): string {
  const h = createHash('sha256').update(`aura-dev:${email.trim().toLowerCase()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Local apps only: http on localhost, the app's own scheme, or Expo Go. */
function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return ['localhost', '127.0.0.1', '10.0.2.2'].includes(u.hostname);
    }
    return u.protocol === 'auracoach:' || u.protocol === 'exp:';
  } catch {
    return false;
  }
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function json(status: number, body: unknown): OAuthResult {
  return {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(body),
  };
}

const page = (title: string, body: string): OAuthResult => ({
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#FAFAF7;color:#16181D;display:flex;justify-content:center;padding:48px 16px}
main{width:100%;max-width:380px}h1{font-size:24px;margin:0 0 6px}p{color:#5B606B;margin:0 0 20px;font-size:14px}.error{color:#B3261E}
label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}input[type=email],input[type=text]{width:100%;box-sizing:border-box;height:48px;padding:0 12px;border:1px solid #DADCD6;border-radius:8px;font-size:16px}
.check{display:flex;gap:8px;align-items:center;margin:16px 0 24px;font-weight:500}button{width:100%;height:52px;border:0;border-radius:12px;background:#0E7C66;color:#fff;font-size:16px;font-weight:600;margin-top:16px}
button.secondary{background:transparent;color:#0E7C66;border:1px solid #DADCD6}</style>
</head><body><main>${body}</main></body></html>`,
});

const oauthError = (error: string, description: string) =>
  json(400, { error, error_description: description });

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/**
 * Cognito-shaped Authorization Code + PKCE endpoints (`/oauth2/authorize`, `/oauth2/token`,
 * `/logout`) so the web BFF and the mobile app run the real sign-in flow locally.
 * There is no password: the form asks for an email and whether to act as staff.
 */
export function createOAuthHandlers(dev: DevIssuer, options: OAuthOptions = {}) {
  const clientIds = options.clientIds ?? ['aura-dev-client'];
  const ttl = options.accessTokenTtlSeconds ?? 900;
  const now = options.now ?? Date.now;
  const groups = options.groups ?? new GroupStore();
  const mfaCode = options.mfaCode ?? DEV_MFA_CODE;
  const codes = new Map<string, PendingCode>();
  const mfaTickets = new Map<string, PendingMfa>();
  const refreshTokens = new Map<string, { clientId: string; user: DevUser }>();

  function checkAuthorizeParams(p: URLSearchParams): string | null {
    if (p.get('response_type') !== 'code') return 'response_type must be code';
    if (!clientIds.includes(p.get('client_id') ?? '')) return 'unknown client_id';
    if (!redirectAllowed(p.get('redirect_uri') ?? '')) return 'redirect_uri not allowed';
    if (!p.get('code_challenge') || p.get('code_challenge_method') !== 'S256') {
      return 'PKCE with S256 is required';
    }
    return null;
  }

  /**
   * Code grant: all three tokens. Refresh grant (`withRefresh` false): no new refresh token.
   * Groups are read now, so grants and revocations show up at the next refresh.
   */
  async function issue(clientId: string, user: DevUser, nonce?: string, withRefresh = true) {
    const current = groups.list(user.sub);
    let refreshToken: string | undefined;
    if (withRefresh) {
      refreshToken = randomBytes(32).toString('base64url');
      refreshTokens.set(refreshToken, { clientId, user });
    }
    return {
      access_token: await dev.mintAccessToken({
        sub: user.sub,
        email: user.email,
        groups: current,
        amr: user.amr,
        clientId,
        expiresIn: `${ttl}s`,
      }),
      id_token: await dev.mintIdToken({
        sub: user.sub,
        email: user.email,
        groups: current,
        clientId,
        ...(nonce ? { nonce } : {}),
      }),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
      token_type: 'Bearer',
      expires_in: ttl,
    };
  }

  /** Finishes sign-in: a one-time code back to the app's redirect URI. */
  function redirectWithCode(form: URLSearchParams, user: DevUser): OAuthResult {
    const code = randomBytes(24).toString('base64url');
    const nonce = form.get('nonce');
    codes.set(code, {
      clientId: form.get('client_id') as string,
      redirectUri: form.get('redirect_uri') as string,
      codeChallenge: form.get('code_challenge') as string,
      ...(nonce ? { nonce } : {}),
      user,
      expiresAt: now() + CODE_TTL_MS,
    });
    const target = new URL(form.get('redirect_uri') as string);
    target.searchParams.set('code', code);
    const state = form.get('state');
    if (state) target.searchParams.set('state', state);
    return { status: 302, headers: { location: target.toString() } };
  }

  function mfaPage(ticket: string, error?: string): OAuthResult {
    return page(
      'AuraCoach dev MFA',
      `<h1>Two-step verification</h1>
<p>Staff accounts need a second step for the admin console. Locally the code is always ${mfaCode}.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/oauth2/mfa"><input type="hidden" name="ticket" value="${escapeHtml(ticket)}">
<label for="code">Authenticator code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" autofocus>
<button type="submit">Verify</button>
<button class="secondary" type="submit" name="skip" value="1">Skip (no admin access)</button></form>`,
    );
  }

  return {
    authorizePage(params: URLSearchParams): OAuthResult {
      const problem = checkAuthorizeParams(params);
      if (problem) return { status: 400, body: problem };
      const hidden = [...params.entries()]
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
        .join('');
      return page(
        'AuraCoach dev sign-in',
        `<h1>Dev sign-in</h1><p>Local stand-in for Cognito. No password; never runs in production.</p>
<form method="post" action="/oauth2/authorize">${hidden}
<label for="email">Email</label><input id="email" name="email" type="email" required value="priya@example.com">
<label class="check"><input type="checkbox" name="staff" value="owner"> Staff: make me an owner (admin console)</label>
<button type="submit">Continue</button></form>`,
      );
    },

    authorizeSubmit(form: URLSearchParams): OAuthResult {
      const problem = checkAuthorizeParams(form);
      if (problem) return { status: 400, body: problem };
      const email = (form.get('email') ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email))
        return { status: 400, body: 'a valid email is required' };
      const sub = devUserId(email);
      // Local bootstrap: the checkbox makes this person an owner, who can then grant other roles.
      if (form.get('staff')) groups.add(sub, 'owner');
      const user: DevUser = { sub, email, amr: ['pwd'] };
      if (groups.list(sub).length === 0) return redirectWithCode(form, user);
      // Staff go through a second step, like Cognito TOTP, so the MFA_REQUIRED path can be tested.
      const ticket = randomBytes(24).toString('base64url');
      mfaTickets.set(ticket, { form, user, expiresAt: now() + CODE_TTL_MS });
      return mfaPage(ticket);
    },

    mfaSubmit(form: URLSearchParams): OAuthResult {
      const ticket = form.get('ticket') ?? '';
      const pending = mfaTickets.get(ticket);
      if (!pending || pending.expiresAt < now()) {
        mfaTickets.delete(ticket);
        return { status: 400, body: 'sign-in expired, start again' };
      }
      if (form.get('skip')) {
        mfaTickets.delete(ticket);
        return redirectWithCode(pending.form, pending.user);
      }
      if (form.get('code')?.trim() !== mfaCode) return mfaPage(ticket, 'That code is not right');
      mfaTickets.delete(ticket);
      return redirectWithCode(pending.form, { ...pending.user, amr: ['pwd', 'mfa'] });
    },

    async token(form: URLSearchParams): Promise<OAuthResult> {
      const clientId = form.get('client_id') ?? '';
      if (!clientIds.includes(clientId)) return json(401, { error: 'invalid_client' });
      const grant = form.get('grant_type');
      if (grant === 'authorization_code') {
        const pending = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (!pending || pending.expiresAt < now() || pending.clientId !== clientId) {
          return oauthError('invalid_grant', 'code is unknown, used or expired');
        }
        if (pending.redirectUri !== form.get('redirect_uri')) {
          return oauthError('invalid_grant', 'redirect_uri does not match');
        }
        if (s256(form.get('code_verifier') ?? '') !== pending.codeChallenge) {
          return oauthError('invalid_grant', 'code_verifier does not match');
        }
        return json(200, await issue(clientId, pending.user, pending.nonce));
      }
      if (grant === 'refresh_token') {
        // Like a Cognito app client without rotation: the refresh token stays valid until it is
        // revoked, and the response carries new access and ID tokens only.
        const entry = refreshTokens.get(form.get('refresh_token') ?? '');
        if (!entry || entry.clientId !== clientId) {
          return oauthError('invalid_grant', 'refresh token is unknown or revoked');
        }
        return json(200, await issue(clientId, entry.user, undefined, false));
      }
      return oauthError('unsupported_grant_type', 'use authorization_code or refresh_token');
    },

    /** Cognito `/oauth2/revoke`: the refresh token stops working. Always 200, like Cognito. */
    revoke(form: URLSearchParams): OAuthResult {
      const entry = refreshTokens.get(form.get('token') ?? '');
      if (entry && entry.clientId === form.get('client_id')) {
        refreshTokens.delete(form.get('token') as string);
      }
      return json(200, {});
    },

    logout(params: URLSearchParams): OAuthResult {
      const target = params.get('logout_uri') ?? params.get('redirect_uri') ?? '';
      if (!redirectAllowed(target)) return { status: 400, body: 'logout_uri not allowed' };
      return { status: 302, headers: { location: target } };
    },
  };
}
