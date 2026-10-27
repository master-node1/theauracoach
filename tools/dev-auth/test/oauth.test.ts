import { createHash } from 'node:crypto';
import { decodeJwt, jwtVerify } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDevIssuer,
  createOAuthHandlers,
  DEV_MFA_CODE,
  devUserId,
  GroupStore,
  handleGroupAdmin,
  type DevIssuer,
  type OAuthResult,
} from '../src';

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
  let groups: GroupStore;

  beforeEach(async () => {
    dev = await createDevIssuer('http://localhost:4100');
    groups = new GroupStore();
    oauth = createOAuthHandlers(dev, { groups });
  });

  function ticketFrom(res: OAuthResult): string {
    expect(res.status).toBe(200);
    return /name="ticket" value="([^"]+)"/.exec(res.body as string)![1]!;
  }

  function codeFrom(res: OAuthResult): string {
    expect(res.status).toBe(302);
    const location = new URL(res.headers?.location as string);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('state')).toBe('state-123');
    return location.searchParams.get('code') as string;
  }

  /** Staff sign-in: `mfa` true enters the code, false skips the step. */
  function signIn(email = 'Priya@Example.com', staff = false, mfa = true) {
    const form = authorizeParams({ email, ...(staff ? { staff: 'owner' } : {}) });
    const res = oauth.authorizeSubmit(form);
    if (res.status === 200) {
      const ticket = ticketFrom(res);
      return codeFrom(
        oauth.mfaSubmit(
          new URLSearchParams(mfa ? { ticket, code: DEV_MFA_CODE } : { ticket, skip: '1' }),
        ),
      );
    }
    return codeFrom(res);
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

  it('makes the staff checkbox an owner and marks MFA in amr after the code step', async () => {
    const body = JSON.parse((await exchange(signIn('asha@example.com', true))).body as string);
    const claims = decodeJwt(body.access_token);
    expect(claims['cognito:groups']).toEqual(['owner']);
    expect(claims.amr).toEqual(['pwd', 'mfa']);
  });

  it('gives users without groups no MFA step and amr pwd only', async () => {
    const body = JSON.parse((await exchange(signIn())).body as string);
    expect(decodeJwt(body.access_token).amr).toEqual(['pwd']);
  });

  it('leaves MFA out of amr when staff skip the step, and rejects a wrong code', async () => {
    const skipped = JSON.parse((await exchange(signIn('ravi@example.com', true, false))).body as string);
    expect(decodeJwt(skipped.access_token).amr).toEqual(['pwd']);

    const ticket = ticketFrom(oauth.authorizeSubmit(authorizeParams({ email: 'ravi@example.com' })));
    const wrong = oauth.mfaSubmit(new URLSearchParams({ ticket, code: '000000' }));
    expect(wrong.status).toBe(200);
    expect(wrong.body).toContain('That code is not right');
    codeFrom(oauth.mfaSubmit(new URLSearchParams({ ticket, code: DEV_MFA_CODE })));
    // A ticket works once.
    expect(oauth.mfaSubmit(new URLSearchParams({ ticket, code: DEV_MFA_CODE })).status).toBe(400);
  });

  it('reads groups at every refresh, so a revoked role drops out', async () => {
    const sub = devUserId('meera@example.com');
    groups.add(sub, 'content_editor');
    const first = JSON.parse((await exchange(signIn('meera@example.com'))).body as string);
    expect(decodeJwt(first.access_token)['cognito:groups']).toEqual(['content_editor']);
    groups.remove(sub, 'content_editor');
    const refreshed = await oauth.token(
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT,
        refresh_token: first.refresh_token,
      }),
    );
    const claims = decodeJwt(JSON.parse(refreshed.body as string).access_token);
    expect(claims['cognito:groups']).toEqual([]);
    expect(claims.amr).toEqual(['pwd', 'mfa']);
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

describe('dev-auth group admin', () => {
  const sub = devUserId('dev@example.com');
  const key = 'k'.repeat(24);
  const call = (store: GroupStore, method: string, path: string, given: string | undefined = key) =>
    handleGroupAdmin(store, key, { method, path, key: given });

  it('adds, lists and removes groups with the admin key only', () => {
    const store = new GroupStore();
    expect(call(store, 'PUT', `/admin/users/${sub}/groups/support`, 'wrong')?.status).toBe(401);
    expect(call(store, 'PUT', `/admin/users/${sub}/groups/support`)?.status).toBe(204);
    expect(JSON.parse(call(store, 'GET', `/admin/users/${sub}/groups`)!.body!)).toEqual({
      groups: ['support'],
    });
    expect(call(store, 'DELETE', `/admin/users/${sub}/groups/support`)?.status).toBe(204);
    expect(store.list(sub)).toEqual([]);
    expect(call(store, 'PUT', `/admin/users/${sub}/groups/Not-Valid`)?.status).toBe(400);
    expect(call(store, 'GET', '/somewhere-else')).toBeNull();
  });
});
