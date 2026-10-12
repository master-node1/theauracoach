import { createHash, randomBytes } from 'node:crypto';
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
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce?: string;
  user: DevUser;
  expiresAt: number;
}

interface DevUser {
  sub: string;
  email: string;
  groups: string[];
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
  const codes = new Map<string, PendingCode>();
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

  async function issue(clientId: string, user: DevUser, nonce?: string) {
    const refreshToken = randomBytes(32).toString('base64url');
    refreshTokens.set(refreshToken, { clientId, user });
    return {
      access_token: await dev.mintAccessToken({
        sub: user.sub,
        email: user.email,
        groups: user.groups,
        clientId,
        expiresIn: `${ttl}s`,
      }),
      id_token: await dev.mintIdToken({ ...user, clientId, ...(nonce ? { nonce } : {}) }),
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: ttl,
    };
  }

  return {
    authorizePage(params: URLSearchParams): OAuthResult {
      const problem = checkAuthorizeParams(params);
      if (problem) return { status: 400, body: problem };
      const hidden = [...params.entries()]
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
        .join('');
      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AuraCoach dev sign-in</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#FAFAF7;color:#16181D;display:flex;justify-content:center;padding:48px 16px}
main{width:100%;max-width:380px}h1{font-size:24px;margin:0 0 6px}p{color:#5B606B;margin:0 0 20px;font-size:14px}
label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}input[type=email]{width:100%;box-sizing:border-box;height:48px;padding:0 12px;border:1px solid #DADCD6;border-radius:8px;font-size:16px}
.check{display:flex;gap:8px;align-items:center;margin:16px 0 24px;font-weight:500}button{width:100%;height:52px;border:0;border-radius:12px;background:#0E7C66;color:#fff;font-size:16px;font-weight:600}</style>
</head><body><main><h1>Dev sign-in</h1><p>Local stand-in for Cognito. No password; never runs in production.</p>
<form method="post" action="/oauth2/authorize">${hidden}
<label for="email">Email</label><input id="email" name="email" type="email" required value="priya@example.com">
<label class="check"><input type="checkbox" name="staff" value="admin"> Staff (admin console)</label>
<button type="submit">Continue</button></form></main></body></html>`,
      };
    },

    authorizeSubmit(form: URLSearchParams): OAuthResult {
      const problem = checkAuthorizeParams(form);
      if (problem) return { status: 400, body: problem };
      const email = (form.get('email') ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { status: 400, body: 'a valid email is required' };
      const code = randomBytes(24).toString('base64url');
      const nonce = form.get('nonce');
      codes.set(code, {
        clientId: form.get('client_id') as string,
        redirectUri: form.get('redirect_uri') as string,
        codeChallenge: form.get('code_challenge') as string,
        ...(nonce ? { nonce } : {}),
        user: { sub: devUserId(email), email, groups: form.get('staff') ? ['admin'] : [] },
        expiresAt: now() + CODE_TTL_MS,
      });
      const target = new URL(form.get('redirect_uri') as string);
      target.searchParams.set('code', code);
      const state = form.get('state');
      if (state) target.searchParams.set('state', state);
      return { status: 302, headers: { location: target.toString() } };
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
        const old = form.get('refresh_token') ?? '';
        const entry = refreshTokens.get(old);
        refreshTokens.delete(old);
        if (!entry || entry.clientId !== clientId) {
          return oauthError('invalid_grant', 'refresh token is unknown or already used');
        }
        return json(200, await issue(clientId, entry.user));
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
