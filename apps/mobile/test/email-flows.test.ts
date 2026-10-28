import { createIdentityClient } from '@aura/api-client';
import { createDevIssuer, createIdentityHandlers, createOAuthHandlers } from '@aura/dev-auth';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmailFlows, parseProviders, type EmailFlows } from '../src/auth/email-flows';

const PASSWORD = 'Correct-Horse-42';

const claims = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1] as string, 'base64url').toString()) as {
    email?: string;
  };

/** The app's flow logic against dev-auth, which speaks Cognito's API (TAC-8). */
describe('mobile email flows', () => {
  let identity: ReturnType<typeof createIdentityHandlers>;
  let flows: EmailFlows;
  let fresh: () => EmailFlows;

  beforeEach(async () => {
    const dev = await createDevIssuer('http://localhost:4100');
    identity = createIdentityHandlers(dev, createOAuthHandlers(dev), { log: () => undefined });
    fresh = () =>
      createEmailFlows(
        createIdentityClient({
          endpoint: 'http://localhost:4100/',
          clientId: 'aura-dev-client',
          fetch: (async (_url: string, init: RequestInit) => {
            const res = await identity.handle(
              new Headers(init.headers).get('x-amz-target') ?? undefined,
              JSON.parse(init.body as string),
            );
            return new Response(res.body ?? null, { status: res.status });
          }) as unknown as typeof fetch,
        }),
        () => 1_800_000_000,
      );
    flows = fresh();
  });

  const code = (email: string, kind: 'signUp' | 'reset') =>
    identity.pendingCodes(email)[kind] as string;

  it('signs up, verifies and signs straight in with tokens for the secure store', async () => {
    expect(await flows.signUp('Ravi@Example.com ', PASSWORD)).toEqual({
      kind: 'next',
      route: '/verify',
      email: 'ravi@example.com',
    });
    const result = await flows.verify('ravi@example.com', code('ravi@example.com', 'signUp'));
    if (result.kind !== 'signedIn') throw new Error(`expected tokens, got ${result.kind}`);
    expect(claims(result.tokens.accessToken).email).toBe('ravi@example.com');
    expect(result.tokens.refreshToken).toBeTruthy();
    expect(result.tokens.expiresAt).toBe(1_800_000_000 + 900);
  });

  it('sends the user to sign in when the app restarted between sign-up and verify', async () => {
    await flows.signUp('meera@example.com', PASSWORD);
    const restarted = fresh(); // the in-memory sign-up session is gone
    const result = await restarted.verify('meera@example.com', code('meera@example.com', 'signUp'));
    expect(result).toMatchObject({ kind: 'next', route: '/sign-in', email: 'meera@example.com' });
    expect((await restarted.signIn('meera@example.com', PASSWORD)).kind).toBe('signedIn');
  });

  it('turns provider errors into plain messages', async () => {
    expect(await flows.signUp('x@example.com', 'weak')).toMatchObject({
      kind: 'error',
      code: 'InvalidPassword',
    });
    await flows.signUp('x@example.com', PASSWORD);
    expect(await flows.signUp('x@example.com', PASSWORD)).toMatchObject({
      code: 'UsernameExists',
      message: expect.stringContaining('already exists'),
    });
    const right = code('x@example.com', 'signUp');
    expect(
      await flows.verify('x@example.com', right === '000000' ? '111111' : '000000'),
    ).toMatchObject({
      code: 'CodeMismatch',
      message: expect.stringContaining('not right'),
    });
    expect(await flows.signIn('x@example.com', PASSWORD)).toMatchObject({
      code: 'UserNotConfirmed',
    });
    expect(await flows.resend('x@example.com')).toBeNull();
  });

  it('resets the password; the old one stops working and unknown emails look the same', async () => {
    await flows.signUp('lata@example.com', PASSWORD);
    await flows.verify('lata@example.com', code('lata@example.com', 'signUp'));
    expect(await flows.forgot('nobody@example.com')).toMatchObject({
      kind: 'next',
      route: '/reset',
    });
    expect(await flows.forgot('lata@example.com')).toMatchObject({ kind: 'next', route: '/reset' });
    const reset = await flows.reset(
      'lata@example.com',
      code('lata@example.com', 'reset'),
      'New-Pass-123x',
    );
    expect(reset).toMatchObject({ kind: 'next', route: '/sign-in' });
    expect(await flows.signIn('lata@example.com', PASSWORD)).toMatchObject({
      code: 'NotAuthorized',
    });
    expect((await flows.signIn('lata@example.com', 'New-Pass-123x')).kind).toBe('signedIn');
  });

  it('reads only known providers from config', () => {
    expect(parseProviders('SignInWithApple,Facebook')).toEqual(['SignInWithApple']);
    expect(parseProviders(undefined)).toEqual([]);
  });
});
