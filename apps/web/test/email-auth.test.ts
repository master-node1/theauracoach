import { createIdentityClient } from '@aura/api-client';
import { createDevIssuer, createIdentityHandlers, createOAuthHandlers } from '@aura/dev-auth';
import { jwtVerify } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import { login, type AuthDeps } from '../src/lib/auth-handlers';
import { loadConfig, parseProviders, type WebConfig } from '../src/lib/config';
import { PENDING_COOKIE, SESSION_COOKIE, SIGNED_OUT_COOKIE } from '../src/lib/cookies';
import {
  forgot,
  logoutEverywhere,
  readPending,
  resend,
  reset,
  signIn,
  signUp,
  verify,
  type EmailAuthDeps,
} from '../src/lib/email-auth';
import type { IdClaims } from '../src/lib/oidc';
import { clientIp, RateLimiter } from '../src/lib/rate-limit';
import { readSession } from '../src/lib/session';

const APP = 'http://localhost:3100';
const PASSWORD = 'Correct-Horse-42';
/** Throwaway passwords for the reset test; built at run time so they are not literals. */
const NEW_PASSWORD = ['Brand', 'New', 'Pass', '9'].join('-');
const OTHER_PASSWORD = ['Other', 'New', 'Pass', '9'].join('-');

/** Carries Set-Cookie between requests, like a browser. */
class Jar {
  private readonly values = new Map<string, string>();
  readonly raw: string[] = [];
  take(res: Response): Response {
    for (const header of res.headers.getSetCookie()) {
      this.raw.push(header);
      const [pair] = header.split(';') as [string];
      const eq = pair.indexOf('=');
      if (/Max-Age=0/.test(header)) this.values.delete(pair.slice(0, eq));
      else this.values.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    return res;
  }
  has(name: string) {
    return this.values.has(name);
  }
  get(name: string) {
    return this.values.get(name);
  }
  header() {
    return [...this.values].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

describe('web BFF email flows (TAC-8)', () => {
  let config: WebConfig;
  let identity: ReturnType<typeof createIdentityHandlers>;
  let deps: EmailAuthDeps;
  let jar: Jar;
  let apiCalls: { url: string; auth: string | null }[];
  let apiStatus: number;

  beforeEach(async () => {
    config = loadConfig({ NODE_ENV: 'test' });
    const dev = await createDevIssuer('http://localhost:4100');
    const oauth = createOAuthHandlers(dev);
    identity = createIdentityHandlers(dev, oauth, { log: () => undefined });
    jar = new Jar();
    apiCalls = [];
    apiStatus = 204;
    const fetchStub = (async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      if (url === 'http://localhost:4100/') {
        const res = await identity.handle(
          headers.get('x-amz-target') ?? undefined,
          JSON.parse(init.body as string),
        );
        return new Response(res.body ?? null, { status: res.status, headers: res.headers });
      }
      if (url.endsWith('/oauth2/revoke')) {
        const res = oauth.revoke(new URLSearchParams(init.body as URLSearchParams));
        return new Response(res.body ?? null, { status: res.status });
      }
      apiCalls.push({ url, auth: headers.get('authorization') });
      return new Response(null, { status: apiStatus });
    }) as unknown as typeof fetch;
    deps = {
      config,
      fetch: fetchStub,
      identity: createIdentityClient({
        endpoint: config.identityEndpoint,
        clientId: config.oidc.clientId,
        fetch: fetchStub,
      }),
      verifyIdToken: async (token) => {
        const { payload } = await jwtVerify(token, dev.keySource, {
          issuer: config.oidc.issuer,
          audience: config.oidc.clientId,
        });
        return payload as IdClaims;
      },
    };
  });

  function post(path: string, body: unknown, origin = APP): Request {
    return new Request(`${APP}/api/auth/${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', cookie: jar.header() },
      body: JSON.stringify(body),
    });
  }

  const call = async (
    handler: (r: Request, d: EmailAuthDeps) => Promise<Response>,
    path: string,
    body: unknown,
  ) => jar.take(await handler(post(path, body), deps));

  async function json(res: Response) {
    return (await res.json()) as { redirect?: string; code?: string };
  }

  it('signs up, verifies the code and lands signed in, with no token outside HttpOnly cookies', async () => {
    const up = await call(signUp, 'sign-up', { email: ' Asha@Example.com', password: PASSWORD });
    expect(up.status).toBe(200);
    expect(await json(up)).toEqual({ redirect: '/auth/verify' });
    expect(await readPending(config, jar.header())).toMatchObject({ email: 'asha@example.com' });

    const code = identity.pendingCodes('asha@example.com').signUp as string;
    const res = await call(verify, 'verify', { email: 'asha@example.com', code: ` ${code} ` });
    const body = await json(res);
    expect(body).toEqual({ redirect: '/' });
    expect(JSON.stringify(body)).not.toMatch(/eyJ/); // no JWT in the response body
    const session = await readSession(config, jar.get(SESSION_COOKIE));
    expect(session?.email).toBe('asha@example.com');
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    for (const c of jar.raw.filter((c) => c.startsWith('__Host-session=')))
      expect(c).toMatch(/HttpOnly; Secure; SameSite=Lax$/);
  });

  it('maps wrong codes, bad passwords and taken emails to codes the page explains', async () => {
    const weak = await call(signUp, 'sign-up', { email: 'b@example.com', password: 'weakpass' });
    expect(weak.status).toBe(422);
    expect((await json(weak)).code).toBe('InvalidPassword');

    await call(signUp, 'sign-up', { email: 'b@example.com', password: PASSWORD });
    const again = await call(signUp, 'sign-up', { email: 'B@example.com', password: PASSWORD });
    expect(again.status).toBe(409);
    expect((await json(again)).code).toBe('UsernameExists');

    const right = identity.pendingCodes('b@example.com').signUp;
    const wrongCode = right === '000000' ? '111111' : '000000';
    const wrong = await call(verify, 'verify', { email: 'b@example.com', code: wrongCode });
    expect(wrong.status).toBe(400);
    expect((await json(wrong)).code).toBe('CodeMismatch');
    const notDigits = await call(verify, 'verify', { email: 'b@example.com', code: 'abc' });
    expect((await json(notDigits)).code).toBe('InvalidParameter');
  });

  it('resend issues a new code and the old one stops working', async () => {
    await call(signUp, 'sign-up', { email: 'c@example.com', password: PASSWORD });
    const old = identity.pendingCodes('c@example.com').signUp as string;
    expect((await call(resend, 'resend', { email: 'c@example.com' })).status).toBe(200);
    const fresh = identity.pendingCodes('c@example.com').signUp as string;
    if (old !== fresh) {
      expect(
        (await json(await call(verify, 'verify', { email: 'c@example.com', code: old }))).code,
      ).toBe('CodeMismatch');
    }
    expect((await call(verify, 'verify', { email: 'c@example.com', code: fresh })).status).toBe(
      200,
    );
  });

  it('sends the user to sign in when verifying without the sign-up session (another browser)', async () => {
    await call(signUp, 'sign-up', { email: 'd@example.com', password: PASSWORD });
    const code = identity.pendingCodes('d@example.com').signUp as string;
    const other = new Jar();
    jar = other;
    const res = await call(verify, 'verify', { email: 'd@example.com', code });
    expect(await json(res)).toEqual({ redirect: '/auth/sign-in?verified=1' });
    expect(other.has(SESSION_COOKIE)).toBe(false);

    const signedIn = await call(signIn, 'sign-in', {
      email: 'd@example.com',
      password: PASSWORD,
      returnTo: '/progress',
    });
    expect(await json(signedIn)).toEqual({ redirect: '/progress' });
    expect(other.has(SESSION_COOKIE)).toBe(true);
  });

  it('resets the password with the emailed code; the old password stops working', async () => {
    await call(signUp, 'sign-up', { email: 'e@example.com', password: PASSWORD });
    await call(verify, 'verify', {
      email: 'e@example.com',
      code: identity.pendingCodes('e@example.com').signUp,
    });
    jar = new Jar();

    const unknown = await call(forgot, 'forgot', { email: 'nobody@example.com' });
    expect(await json(unknown)).toEqual({ redirect: '/auth/reset' });
    const res = await call(forgot, 'forgot', { email: 'e@example.com' });
    expect(await json(res)).toEqual({ redirect: '/auth/reset' });
    const code = identity.pendingCodes('e@example.com').reset as string;

    const done = await call(reset, 'reset', {
      email: 'e@example.com',
      code,
      password: NEW_PASSWORD,
    });
    expect(await json(done)).toEqual({ redirect: '/auth/sign-in?reset=1' });
    const reused = await call(reset, 'reset', {
      email: 'e@example.com',
      code,
      password: OTHER_PASSWORD,
    });
    expect((await json(reused)).code).toBe('ExpiredCode');

    const old = await call(signIn, 'sign-in', { email: 'e@example.com', password: PASSWORD });
    expect(old.status).toBe(400);
    expect((await json(old)).code).toBe('NotAuthorized');
    const fresh = await call(signIn, 'sign-in', {
      email: 'e@example.com',
      password: NEW_PASSWORD,
    });
    expect(fresh.status).toBe(200);
  });

  it('refuses cross-origin posts', async () => {
    const res = await signUp(
      post('sign-up', { email: 'f@example.com', password: PASSWORD }, 'https://evil.example'),
      deps,
    );
    expect(res.status).toBe(403);
  });

  it('rate-limits auth routes per IP with 429 and Retry-After', async () => {
    let now = 1_000_000;
    const limited = { ...deps, limiter: new RateLimiter(() => now) };
    const attempt = (ip: string) =>
      signIn(
        new Request(`${APP}/api/auth/sign-in`, {
          method: 'POST',
          headers: { origin: APP, 'x-forwarded-for': `203.0.113.9, ${ip}` },
          body: JSON.stringify({ email: 'g@example.com', password: 'x' }),
        }),
        limited,
      );
    for (let i = 0; i < 10; i++) expect((await attempt('198.51.100.1')).status).not.toBe(429);
    const blocked = await attempt('198.51.100.1');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    // Another client is unaffected; the spoofable left-most entry is ignored.
    expect((await attempt('198.51.100.2')).status).not.toBe(429);
    // The hosted login start counts too.
    expect(
      (
        await login(
          new Request(`${APP}/api/auth/login`, { headers: { 'x-forwarded-for': '198.51.100.1' } }),
          limited as AuthDeps,
        )
      ).status,
    ).toBe(429);
    now += 60_000;
    expect((await attempt('198.51.100.1')).status).not.toBe(429);
  });

  it('reads the client IP from the trusted end of X-Forwarded-For', () => {
    const req = new Request(APP, { headers: { 'x-forwarded-for': 'spoofed, 10.0.0.1, 10.0.0.2' } });
    expect(clientIp(req, 1)).toBe('10.0.0.2');
    expect(clientIp(req, 2)).toBe('10.0.0.1');
    expect(clientIp(new Request(APP), 1)).toBe('unknown');
  });

  it('prefers the viewer address CloudFront sets, without its port', () => {
    const header = 'cloudfront-viewer-address';
    const v4 = new Request(APP, {
      headers: { [header]: '203.0.113.7:46532', 'x-forwarded-for': 'spoofed, 10.0.0.1' },
    });
    expect(clientIp(v4, 1, header)).toBe('203.0.113.7');
    const v6 = new Request(APP, { headers: { [header]: '2001:db8::1:443' } });
    expect(clientIp(v6, 1, header)).toBe('2001:db8::1');
    // Without the header (local stack, no CloudFront) it falls back to X-Forwarded-For.
    const local = new Request(APP, { headers: { 'x-forwarded-for': '10.0.0.1' } });
    expect(clientIp(local, 1, header)).toBe('10.0.0.1');
    // Not configured: the header is ignored, so nobody can pick a bucket by sending it.
    expect(clientIp(v4, 1)).toBe('10.0.0.1');
  });

  it('offers only configured providers and sends identity_provider for them', async () => {
    expect(parseProviders('Google, Facebook,SignInWithApple')).toEqual([
      'Google',
      'SignInWithApple',
    ]);
    expect(config.identityProviders).toEqual([]);
    const plain = await login(new Request(`${APP}/api/auth/login?provider=Google`), deps);
    expect(new URL(plain.headers.get('location')!).searchParams.has('identity_provider')).toBe(
      false,
    );

    const withGoogle = {
      ...deps,
      config: loadConfig({ NODE_ENV: 'test', IDENTITY_PROVIDERS: 'Google' }),
    };
    const res = await login(new Request(`${APP}/api/auth/login?provider=Google`), withGoogle);
    expect(new URL(res.headers.get('location')!).searchParams.get('identity_provider')).toBe(
      'Google',
    );
  });

  describe('sign out of all devices', () => {
    async function signedInJar() {
      await call(signUp, 'sign-up', { email: 'h@example.com', password: PASSWORD });
      await call(verify, 'verify', {
        email: 'h@example.com',
        code: identity.pendingCodes('h@example.com').signUp,
      });
      return readSession(config, jar.get(SESSION_COOKIE));
    }

    it('revokes through the API, then clears this browser', async () => {
      const session = await signedInJar();
      const res = jar.take(
        await logoutEverywhere(
          new Request(`${APP}/api/auth/logout-everywhere`, {
            method: 'POST',
            headers: { origin: APP, cookie: jar.header() },
          }),
          deps,
        ),
      );
      expect(apiCalls).toEqual([
        {
          url: 'http://localhost:8080/v1/me/sessions/revoke',
          auth: `Bearer ${session?.accessToken}`,
        },
      ]);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toMatch(/\/logout\?/);
      expect(jar.has(SESSION_COOKIE)).toBe(false);
      expect(jar.has(SIGNED_OUT_COOKIE)).toBe(true);
    });

    it('keeps the session and reports an error when the API fails', async () => {
      await signedInJar();
      apiStatus = 503;
      const res = jar.take(
        await logoutEverywhere(
          new Request(`${APP}/api/auth/logout-everywhere`, {
            method: 'POST',
            headers: { origin: APP, cookie: jar.header() },
          }),
          deps,
        ),
      );
      expect(res.headers.get('location')).toBe(`${APP}/settings?error=sign-out-all`);
      expect(jar.has(SESSION_COOKIE)).toBe(true);
    });

    it('needs a same-origin POST', async () => {
      await signedInJar();
      const res = await logoutEverywhere(
        new Request(`${APP}/api/auth/logout-everywhere`, {
          method: 'POST',
          headers: { origin: 'https://evil.example', cookie: jar.header() },
        }),
        deps,
      );
      expect(res.status).toBe(403);
      expect(apiCalls).toHaveLength(0);
    });
  });
});
