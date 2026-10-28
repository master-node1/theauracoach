import { createIdentityClient, IdentityError, type IdentityClient } from '@aura/api-client';
import { decodeJwt } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createDevIssuer,
  createIdentityHandlers,
  createOAuthHandlers,
  devUserId,
  MAX_CODE_FAILURES,
} from '../src';

const CLIENT = 'aura-dev-client';
const PASSWORD = 'Correct-Horse-42';

describe('dev-auth identity API (Cognito-shaped)', () => {
  let clock: number;
  let identity: ReturnType<typeof createIdentityHandlers>;
  let oauth: ReturnType<typeof createOAuthHandlers>;
  let client: IdentityClient;
  const logs: string[] = [];

  beforeEach(async () => {
    clock = 1_800_000_000_000;
    const dev = await createDevIssuer('http://localhost:4100');
    oauth = createOAuthHandlers(dev, { now: () => clock });
    identity = createIdentityHandlers(dev, oauth, { now: () => clock, log: (l) => logs.push(l) });
    // The shared client talks to the handlers exactly as it would over HTTP.
    client = createIdentityClient({
      endpoint: 'http://localhost:4100/',
      clientId: CLIENT,
      fetch: (async (_url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        const res = await identity.handle(
          headers.get('x-amz-target') ?? undefined,
          JSON.parse(init.body as string),
        );
        return new Response(res.body ?? null, { status: res.status, headers: res.headers });
      }) as unknown as typeof fetch,
    });
  });

  const code = (email: string, kind: 'signUp' | 'reset') =>
    identity.pendingCodes(email)[kind] as string;

  async function expectCode(p: Promise<unknown>, expected: string) {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(IdentityError);
    expect((err as IdentityError).code).toBe(expected);
  }

  it('signs up, confirms with the emailed code and signs in with the sign-up session', async () => {
    const { confirmed, session } = await client.signUp(' Asha@Example.com ', PASSWORD);
    expect(confirmed).toBe(false);
    expect(logs.at(-1)).toMatch(/sign-up code for asha@example.com: \d{6}/);

    const confirmedSession = await client.confirmSignUp(
      'asha@example.com',
      code('asha@example.com', 'signUp'),
      session,
    );
    const tokens = await client.signInAfterConfirm('asha@example.com', confirmedSession.session!);
    const claims = decodeJwt(tokens.accessToken);
    expect(claims).toMatchObject({ sub: devUserId('asha@example.com'), email: 'asha@example.com' });
    expect(tokens.refreshToken).toBeTruthy();
    // The session is single use.
    await expectCode(
      client.signInAfterConfirm('asha@example.com', confirmedSession.session!),
      'NotAuthorized',
    );
  });

  it('finds and deletes users like ListUsers and AdminDeleteUser (account deletion)', async () => {
    const call = async (action: string, input: object) => {
      const res = await identity.handle(`AWSCognitoIdentityProviderService.${action}`, input);
      return { status: res.status, body: JSON.parse(res.body as string) };
    };
    await client.signUp('meera@example.com', PASSWORD);
    await client.confirmSignUp('meera@example.com', code('meera@example.com', 'signUp'));
    const signedIn = await client.signInWithPassword('meera@example.com', PASSWORD);
    const sub = decodeJwt(signedIn.accessToken).sub as string;
    expect(decodeJwt(signedIn.accessToken).auth_time).toBe(1_800_000_000);

    const found = await call('ListUsers', { UserPoolId: 'local', Filter: `sub = "${sub}"` });
    expect(found.body.Users).toEqual([expect.objectContaining({ Username: sub })]);
    expect((await call('AdminDeleteUser', { UserPoolId: 'local', Username: sub })).status).toBe(
      200,
    );
    expect(
      (await call('ListUsers', { UserPoolId: 'local', Filter: `sub = "${sub}"` })).body.Users,
    ).toEqual([]);
    expect((await call('AdminDeleteUser', { Username: sub })).body.__type).toBe(
      'UserNotFoundException',
    );
    await expectCode(client.signInWithPassword('meera@example.com', PASSWORD), 'NotAuthorized');
    // The same email can sign up again, as a new user.
    await client.signUp('meera@example.com', PASSWORD);
    await client.confirmSignUp('meera@example.com', code('meera@example.com', 'signUp'));
    const reborn = await client.signInWithPassword('meera@example.com', PASSWORD);
    expect(decodeJwt(reborn.accessToken).sub).toBe(devUserId('meera@example.com', 1));
  });

  it('enforces the password policy and unique emails', async () => {
    await expectCode(client.signUp('a@example.com', 'short1A'), 'InvalidPassword');
    await expectCode(client.signUp('a@example.com', 'alllowercase123'), 'InvalidPassword');
    await client.signUp('a@example.com', PASSWORD);
    await expectCode(client.signUp('A@example.com', PASSWORD), 'UsernameExists');
  });

  it('rejects wrong, expired and reused codes and locks after repeated failures', async () => {
    await client.signUp('b@example.com', PASSWORD);
    await expectCode(client.confirmSignUp('b@example.com', '000000x'), 'CodeMismatch');

    clock += 15 * 60_000 + 1;
    await expectCode(
      client.confirmSignUp('b@example.com', code('b@example.com', 'signUp') ?? '123456'),
      'ExpiredCode',
    );

    await client.resendCode('b@example.com');
    const fresh = code('b@example.com', 'signUp');
    for (let i = 0; i < MAX_CODE_FAILURES; i++) {
      await expectCode(client.confirmSignUp('b@example.com', 'nope'), 'CodeMismatch');
    }
    await expectCode(client.confirmSignUp('b@example.com', fresh), 'LimitExceeded');

    await client.resendCode('b@example.com');
    const last = code('b@example.com', 'signUp');
    await client.confirmSignUp('b@example.com', last);
    await expectCode(client.confirmSignUp('b@example.com', last), 'NotAuthorized');
  });

  it('only signs in confirmed users with the right password', async () => {
    await client.signUp('c@example.com', PASSWORD);
    await expectCode(client.signInWithPassword('c@example.com', PASSWORD), 'UserNotConfirmed');
    await client.confirmSignUp('c@example.com', code('c@example.com', 'signUp'));
    await expectCode(client.signInWithPassword('c@example.com', 'Wrong-Pass-99'), 'NotAuthorized');
    await expectCode(client.signInWithPassword('nobody@example.com', PASSWORD), 'NotAuthorized');
    expect((await client.signInWithPassword('C@example.com', PASSWORD)).accessToken).toBeTruthy();
  });

  it('resets a password with a single-use code; the old password stops working', async () => {
    await client.signUp('d@example.com', PASSWORD);
    await client.confirmSignUp('d@example.com', code('d@example.com', 'signUp'));

    await client.forgotPassword('d@example.com');
    await client.forgotPassword('unknown@example.com'); // same answer, no code
    expect(identity.pendingCodes('unknown@example.com')).toEqual({});

    const reset = code('d@example.com', 'reset');
    await expectCode(
      client.confirmForgotPassword('d@example.com', reset, 'weak'),
      'InvalidPassword',
    );
    await client.confirmForgotPassword('d@example.com', reset, 'New-Password-77');
    await expectCode(
      client.confirmForgotPassword('d@example.com', reset, 'Other-Password-77'),
      'ExpiredCode',
    );

    await expectCode(client.signInWithPassword('d@example.com', PASSWORD), 'NotAuthorized');
    expect(
      (await client.signInWithPassword('d@example.com', 'New-Password-77')).idToken,
    ).toBeTruthy();
  });

  it('limits how many codes one email can be sent', async () => {
    await client.signUp('e@example.com', PASSWORD);
    for (let i = 0; i < 4; i++) await client.resendCode('e@example.com');
    await expectCode(client.resendCode('e@example.com'), 'LimitExceeded');
    clock += 15 * 60_000;
    await client.resendCode('e@example.com');
  });

  it('GlobalSignOut revokes every refresh token of the user', async () => {
    await client.signUp('f@example.com', PASSWORD);
    await client.confirmSignUp('f@example.com', code('f@example.com', 'signUp'));
    const phone = await client.signInWithPassword('f@example.com', PASSWORD);
    const laptop = await client.signInWithPassword('f@example.com', PASSWORD);

    await client.globalSignOut(phone.accessToken);
    for (const t of [phone, laptop]) {
      const res = await oauth.token(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT,
          refresh_token: t.refreshToken!,
        }),
      );
      expect(res.status).toBe(400);
    }
    await expectCode(client.globalSignOut('not-a-token'), 'NotAuthorized');
  });

  it('answers unknown actions and clients with Cognito errors', async () => {
    const res = await identity.handle('AWSCognitoIdentityProviderService.AdminDisableUser', {});
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body!).__type).toBe('UnknownOperationException');
    const other = createIdentityClient({
      endpoint: 'http://localhost:4100/',
      clientId: 'someone-else',
      fetch: (async (_u: string, init: RequestInit) => {
        const r = await identity.handle(
          new Headers(init.headers).get('x-amz-target') ?? undefined,
          JSON.parse(init.body as string),
        );
        return new Response(r.body ?? null, { status: r.status });
      }) as unknown as typeof fetch,
    });
    await expectCode(other.signUp('g@example.com', PASSWORD), 'Unavailable');
  });
});
