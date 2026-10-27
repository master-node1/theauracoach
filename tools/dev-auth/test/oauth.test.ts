import { createHash } from 'node:crypto';
import { decodeJwt, jwtVerify } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDevIssuer, createOAuthHandlers, devUserId, type DevIssuer } from '../src';

const CLIENT = 'aura-dev-client';
const REDIRECT = 'http://localhost:3100/api/auth/callback';
const VERIFIER = 'a-long-random-code-verifier-0123456789-abcdefghijklmnop';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

function authorizeParams(extra: Record<string, string> = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'state-123',
    nonce: 'nonce-456',
    ...extra,
  });
}

describe('dev-auth OAuth flow', () => {
  let dev: DevIssuer;
  let oauth: ReturnType<typeof createOAuthHandlers>;

  beforeEach(async () => {
    dev = await createDevIssuer('http://localhost:4100');
    oauth = createOAuthHandlers(dev);
  });

  function signIn(email = 'Priya@Example.com', staff = false) {
    const form = authorizeParams({ email, ...(staff ? { staff: 'admin' } : {}) });
    const res = oauth.authorizeSubmit(form);
    expect(res.status).toBe(302);
    const location = new URL(res.headers?.location as string);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('state-123');
    return location.searchParams.get('code') as string;
  }

  function exchange(code: string, verifier = VERIFIER) {
    return oauth.token(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT,
        code,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
      }),
    );
  }

  it('shows the sign-in form only for valid PKCE requests', () => {
    expect(oauth.authorizePage(authorizeParams()).status).toBe(200);
    expect(oauth.authorizePage(authorizeParams({ code_challenge_method: 'plain' })).status).toBe(
      400,
    );
    expect(oauth.authorizePage(authorizeParams({ client_id: 'other' })).status).toBe(400);
    expect(
      oauth.authorizePage(authorizeParams({ redirect_uri: 'https://evil.example/cb' })).status,
    ).toBe(400);
  });

  it('escapes request values in the form', () => {
    const page = oauth.authorizePage(authorizeParams({ state: '"><script>x</script>' }));
    expect(page.body).not.toContain('<script>x</script>');
  });

  it('exchanges a code for Cognito-shaped tokens once', async () => {
    const code = signIn();
    const res = await exchange(code);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body as string);
    const { payload } = await jwtVerify(body.access_token, dev.keySource, {
      issuer: 'http://localhost:4100',
    });
    expect(payload).toMatchObject({
      token_use: 'access',
      client_id: CLIENT,
      email: 'priya@example.com',
      sub: devUserId('priya@example.com'),
      'cognito:groups': [],
    });
    expect(decodeJwt(body.id_token)).toMatchObject({ aud: CLIENT, nonce: 'nonce-456' });
    expect(body.expires_in).toBe(900);
    expect((await exchange(code)).status).toBe(400);
  });

  it('rejects a wrong code verifier', async () => {
    const res = await exchange(signIn(), 'not-the-verifier');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body as string).error).toBe('invalid_grant');
  });

  it('puts staff in the admin group', async () => {
    const body = JSON.parse((await exchange(signIn('asha@example.com', true))).body as string);
    expect(decodeJwt(body.access_token)['cognito:groups']).toEqual(['admin']);
  });

  it('refreshes like Cognito without rotation and honours revoke', async () => {
    const first = JSON.parse((await exchange(signIn())).body as string);
    const refresh = (token: string) =>
      oauth.token(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT,
          refresh_token: token,
        }),
      );
    const second = await refresh(first.refresh_token);
    expect(second.status).toBe(200);
    const body = JSON.parse(second.body as string);
    expect(body.access_token).toEqual(expect.any(String));
    expect(body.id_token).toEqual(expect.any(String));
    expect(body.refresh_token).toBeUndefined();
    expect((await refresh(first.refresh_token)).status).toBe(200);
    oauth.revoke(new URLSearchParams({ token: first.refresh_token, client_id: CLIENT }));
    expect((await refresh(first.refresh_token)).status).toBe(400);
  });

  it('stamps auth_time at sign-in and keeps it across refreshes', async () => {
    let clock = 1_800_000_000_000;
    oauth = createOAuthHandlers(dev, { now: () => clock });
    const first = JSON.parse((await exchange(signIn())).body as string);
    expect(decodeJwt(first.access_token).auth_time).toBe(1_800_000_000);
    clock += 600_000;
    const refreshed = await oauth.token(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT,
        refresh_token: first.refresh_token,
      }),
    );
    expect(decodeJwt(JSON.parse(refreshed.body as string).access_token).auth_time).toBe(
      1_800_000_000,
    );
  });

  it('deletes users like AdminDeleteUser: refresh stops, the email signs up as someone new', async () => {
    const first = JSON.parse((await exchange(signIn())).body as string);
    const sub = decodeJwt(first.access_token).sub as string;
    expect(oauth.deleteUser(sub).status).toBe(200);
    const refresh = await oauth.token(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT,
        refresh_token: first.refresh_token,
      }),
    );
    expect(refresh.status).toBe(400);
    const again = JSON.parse((await exchange(signIn())).body as string);
    const newSub = decodeJwt(again.access_token).sub;
    expect(newSub).not.toBe(sub);
    expect(newSub).toBe(devUserId('priya@example.com', 1));
  });

  it('gives the same email the same UUID subject', () => {
    expect(devUserId('a@b.co')).toBe(devUserId(' A@B.CO '));
    expect(devUserId('a@b.co')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('only redirects to local apps on logout', () => {
    expect(oauth.logout(new URLSearchParams({ logout_uri: 'http://localhost:3100/' })).status).toBe(
      302,
    );
    expect(oauth.logout(new URLSearchParams({ logout_uri: 'https://evil.example' })).status).toBe(
      400,
    );
  });
});
