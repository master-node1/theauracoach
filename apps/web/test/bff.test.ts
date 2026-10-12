import { jwtVerify } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevIssuer, createOAuthHandlers, type DevIssuer } from '@aura/dev-auth';
import { forwardToApi } from '../src/lib/api-proxy';
import { callback, login, logout, refresh, type AuthDeps } from '../src/lib/auth-handlers';
import { loadConfig, type WebConfig } from '../src/lib/config';
import { FLOW_COOKIE, REFRESH_COOKIE, SESSION_COOKIE } from '../src/lib/cookies';
import { safeReturnTo } from '../src/lib/csrf';
import type { IdClaims } from '../src/lib/oidc';
import {
  isStaff,
  readRefreshToken,
  readSession,
  resolveSession,
  type Session,
} from '../src/lib/session';

const APP = 'http://localhost:3100';
const config: WebConfig = loadConfig({ NODE_ENV: 'test' });

/** A browser cookie jar, just enough to carry Set-Cookie between requests. */
class Jar {
  private readonly values = new Map<string, string>();
  readonly raw: string[] = [];
  take(res: Response): Response {
    for (const header of res.headers.getSetCookie()) {
      this.raw.push(header);
      const [pair] = header.split(';') as [string];
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/Max-Age=0/.test(header)) this.values.delete(name);
      else this.values.set(name, value);
    }
    return res;
  }
  has(name: string): boolean {
    return this.values.has(name);
  }
  get(name: string): string | undefined {
    return this.values.get(name);
  }
  header(): string {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

describe('web BFF', () => {
  let dev: DevIssuer;
  let oauth: ReturnType<typeof createOAuthHandlers>;
  let deps: AuthDeps;
  let jar: Jar;
  let clock: number;
  const providerFetch = vi.fn();

  beforeEach(async () => {
    dev = await createDevIssuer('http://localhost:4100');
    clock = 1_800_000_000;
    oauth = createOAuthHandlers(dev, { now: () => clock * 1000 });
    jar = new Jar();
    providerFetch.mockReset();
    providerFetch.mockImplementation(async (url: string, init: RequestInit) => {
      const form = new URLSearchParams(init.body as URLSearchParams);
      const path = new URL(url).pathname;
      const result = path === '/oauth2/token' ? await oauth.token(form) : oauth.revoke(form);
      return new Response(result.body ?? null, { status: result.status });
    });
    deps = {
      config,
      fetch: providerFetch as unknown as typeof fetch,
      now: () => clock,
      verifyIdToken: async (token, nonce) => {
        const { payload } = await jwtVerify(token, dev.keySource, {
          issuer: config.oidc.issuer,
          audience: config.oidc.clientId,
        });
        if (nonce !== undefined && payload.nonce !== nonce) throw new Error('nonce mismatch');
        return payload as IdClaims;
      },
    };
  });

  async function startLogin(returnTo = '/progress') {
    const res = jar.take(
      await login(new Request(`${APP}/api/auth/login?returnTo=${returnTo}`), deps),
    );
    expect(res.status).toBe(302);
    return new URL(res.headers.get('location') as string);
  }

  /** The user submits dev-auth's form; returns the callback URL the browser is sent to. */
  function submitForm(authorize: URL, extra: Record<string, string> = {}) {
    const form = new URLSearchParams(authorize.searchParams);
    form.set('email', 'priya@example.com');
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    const res = oauth.authorizeSubmit(form);
    return new URL(res.headers?.location as string);
  }

  async function signIn(extra: Record<string, string> = {}) {
    const back = submitForm(await startLogin(), extra);
    return jar.take(await callback(new Request(back, { headers: { cookie: jar.header() } }), deps));
  }

  it('starts Authorization Code + PKCE with state and nonce', async () => {
    const url = await startLogin();
    expect(url.origin + url.pathname).toBe('http://localhost:4100/oauth2/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/callback`);
    expect(url.searchParams.get('state')).toHaveLength(43);
    expect(url.searchParams.get('nonce')).toHaveLength(43);
    expect(jar.raw[0]).toMatch(
      /^__Host-auth-flow=.+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it('signs in and sets only encrypted, HttpOnly, Secure, SameSite=Lax cookies', async () => {
    const res = await signIn();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${APP}/progress`);
    const set = jar.raw.filter(
      (c) => c.startsWith('__Host-session=') || c.startsWith('__Host-refresh='),
    );
    expect(set).toHaveLength(2);
    for (const cookie of set)
      expect(cookie).toMatch(/; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);
    expect(jar.has(FLOW_COOKIE)).toBe(false);

    const session = (await readSession(config, jar.get(SESSION_COOKIE))) as Session;
    expect(session.email).toBe('priya@example.com');
    expect(session.expiresAt).toBe(clock + 900);
    // The cookie is a JWE: the access token is not in it in any readable form.
    const body = session.accessToken.split('.')[1] as string;
    expect(jar.get(SESSION_COOKIE)).not.toContain(body);
    expect(jar.get(SESSION_COOKIE)?.split('.')).toHaveLength(5);
  });

  it('refuses a callback whose state does not match', async () => {
    const back = submitForm(await startLogin());
    back.searchParams.set('state', 'forged');
    const res = jar.take(
      await callback(new Request(back, { headers: { cookie: jar.header() } }), deps),
    );
    expect(res.headers.get('location')).toBe(`${APP}/auth/sign-in?error=state`);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('refuses a callback without the flow cookie (login CSRF)', async () => {
    const back = submitForm(await startLogin());
    const res = await callback(new Request(back), deps);
    expect(res.headers.get('location')).toBe(`${APP}/auth/sign-in?error=state`);
  });

  it('refuses an ID token with the wrong nonce', async () => {
    const res = await signIn({ nonce: 'someone-elses-nonce' });
    expect(res.headers.get('location')).toBe(`${APP}/auth/sign-in?error=tokens`);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
  });

  it('keeps a fresh session and refreshes one with under 60 s left', async () => {
    await signIn();
    const first = (await readSession(config, jar.get(SESSION_COOKIE))) as Session;

    clock += 900 - 61;
    expect((await resolveSession(config, jar.header(), deps)).kind).toBe('valid');

    clock += 2;
    const state = await resolveSession(config, jar.header(), deps);
    expect(state.kind).toBe('refreshed');
    if (state.kind !== 'refreshed') return;
    const [, init] = providerFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(new URLSearchParams(init.body as URLSearchParams).get('grant_type')).toBe(
      'refresh_token',
    );
    expect(state.session.sub).toBe(first.sub);
    expect(state.session.expiresAt).toBe(clock + 900);
    expect(state.setCookies.map((c) => c.split('=')[0])).toEqual([SESSION_COOKIE]);
    expect(await readSession(config, state.sessionCookie)).toEqual(state.session);
  });

  it('signs the user out once the refresh token is revoked', async () => {
    await signIn();
    const refreshToken = await readRefreshToken(config, jar.get(REFRESH_COOKIE));
    oauth.revoke(
      new URLSearchParams({ token: refreshToken as string, client_id: 'aura-dev-client' }),
    );

    // Still inside the token's life: keep using it rather than failing the request.
    clock += 900 - 30;
    expect((await resolveSession(config, jar.header(), deps)).kind).toBe('valid');

    clock += 30;
    expect(await resolveSession(config, jar.header(), deps)).toEqual({
      kind: 'none',
      setCookies: [
        expect.stringMatching(/^__Host-session=; .*Max-Age=0/),
        expect.stringMatching(/^__Host-refresh=; .*Max-Age=0/),
      ],
    });
  });

  it('refresh route needs a same-origin POST', async () => {
    await signIn();
    const post = (origin?: string) =>
      new Request(`${APP}/api/auth/refresh`, {
        method: 'POST',
        headers: { cookie: jar.header(), ...(origin ? { origin } : {}) },
      });
    expect((await refresh(post('https://evil.example'), deps)).status).toBe(403);
    expect((await refresh(post(), deps)).status).toBe(403);
    expect((await refresh(post(APP), deps)).status).toBe(204);
  });

  it('logout revokes the refresh token, clears cookies and ends the provider session', async () => {
    await signIn();
    const cookieHeader = jar.header();
    const crossSite = await logout(
      new Request(`${APP}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie: cookieHeader, origin: 'https://evil.example' },
      }),
      deps,
    );
    expect(crossSite.status).toBe(403);

    const res = jar.take(
      await logout(
        new Request(`${APP}/api/auth/logout`, {
          method: 'POST',
          headers: { cookie: cookieHeader, origin: APP },
        }),
        deps,
      ),
    );
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location') as string);
    expect(location.origin + location.pathname).toBe('http://localhost:4100/logout');
    expect(location.searchParams.get('logout_uri')).toBe(`${APP}/auth/sign-in`);
    expect(jar.has(SESSION_COOKIE)).toBe(false);
    expect(jar.has(REFRESH_COOKIE)).toBe(false);
    clock += 900;
    expect((await resolveSession(config, cookieHeader, deps)).kind).toBe('none');

    // A response that was in flight during sign out puts a session cookie back: still signed out.
    expect((await resolveSession(config, `${cookieHeader}; ${jar.header()}`, deps)).kind).toBe(
      'none',
    );
    // Signing in again clears the marker.
    await signIn();
    expect(jar.has('__Host-signed-out')).toBe(false);
    expect((await resolveSession(config, jar.header(), deps)).kind).toBe('valid');
  });

  describe('/api/v1 proxy', () => {
    const session: Session = {
      accessToken: 'access-1',
      expiresAt: 0,
      sub: '0b6f5c1e-8f0a-4b8e-9c47-3d2a1e5f7a90',
      email: 'priya@example.com',
      groups: [],
    };

    it('attaches the bearer and forwards only safe headers', async () => {
      const upstream = vi.fn(
        async () =>
          new Response('{"ok":true}', {
            status: 201,
            headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' },
          }),
      );
      const req = new Request(`${APP}/api/v1/workouts/a%20b?week=2`, {
        method: 'POST',
        headers: {
          origin: APP,
          cookie: 'secret=1',
          'content-type': 'application/json',
          'idempotency-key': 'k1',
        },
        body: '{"x":1}',
      });
      const res = await forwardToApi(
        req,
        ['workouts', 'a b'],
        session,
        config,
        upstream as unknown as typeof fetch,
      );
      expect(res.status).toBe(201);
      expect(res.headers.get('set-cookie')).toBeNull();
      const [url, init] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.toString()).toBe('http://localhost:8080/v1/workouts/a%20b?week=2');
      const headers = new Headers(init.headers);
      expect(headers.get('authorization')).toBe('Bearer access-1');
      expect(headers.get('idempotency-key')).toBe('k1');
      expect(headers.has('cookie')).toBe(false);
      expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"x":1}');
    });

    it('rejects cross-origin writes and anonymous calls', async () => {
      const upstream = vi.fn();
      const post = new Request(`${APP}/api/v1/me`, {
        method: 'PATCH',
        headers: { origin: 'https://evil.example' },
      });
      expect((await forwardToApi(post, ['me'], session, config, upstream)).status).toBe(403);
      const get = new Request(`${APP}/api/v1/me`);
      expect((await forwardToApi(get, ['me'], null, config, upstream)).status).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
    });
  });

  it('only returns to local paths after sign-in', () => {
    expect(safeReturnTo('/eat?day=1')).toBe('/eat?day=1');
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/api/auth/logout',
      null,
    ]) {
      expect(safeReturnTo(bad)).toBe('/');
    }
  });

  it('treats any non-user role as staff', () => {
    expect(isStaff([])).toBe(false);
    expect(isStaff(['user'])).toBe(false);
    expect(isStaff(['admin'])).toBe(true);
    expect(isStaff(['support'])).toBe(true);
    expect(isStaff(['owner-of-nothing'])).toBe(false);
  });

  it('requires real settings in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/must be set/);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        APP_URL: 'https://app.example',
        API_BASE_URL: 'https://api.example',
        OIDC_DOMAIN_URL: 'https://auth.example',
        OIDC_ISSUER: 'https://issuer.example',
        OIDC_CLIENT_ID: 'client',
        SESSION_SECRET: 'too-short',
      }),
    ).toThrow(/32 characters/);
  });
});
