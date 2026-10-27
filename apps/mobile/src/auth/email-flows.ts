import {
  IdentityError,
  confirmSignUpSchema,
  emailOnlySchema,
  identityErrorMessage,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type IdentityClient,
  type IdentityTokens,
} from '@aura/api-client';
import { fromTokenResult, nowSeconds, type StoredTokens } from './tokens';

/**
 * Email sign-up, verification, sign-in and password reset for the app (TAC-8), with no React
 * Native imports so vitest can run it against dev-auth. The app calls the identity provider
 * directly (no BFF on mobile); tokens go straight to the secure store through AuthProvider.
 */

/** A step's outcome: tokens to store, a screen to go to, or a message to show. */
export type FlowResult =
  | { kind: 'signedIn'; tokens: StoredTokens }
  | { kind: 'next'; route: '/verify' | '/reset' | '/sign-in'; email: string; notice?: string }
  | { kind: 'error'; code: string; message: string };

const fail = (code: string): FlowResult => ({
  kind: 'error',
  code,
  message: identityErrorMessage(code),
});

function caught(err: unknown): FlowResult {
  return fail(err instanceof IdentityError ? err.code : 'Unavailable');
}

export function storedTokens(tokens: IdentityTokens, now = nowSeconds()): StoredTokens {
  return fromTokenResult(
    {
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      expiresIn: tokens.expiresIn,
      issuedAt: now,
    },
    null,
    now,
  );
}

export interface EmailFlows {
  signUp(email: string, password: string): Promise<FlowResult>;
  verify(email: string, code: string): Promise<FlowResult>;
  resend(email: string): Promise<FlowResult | null>;
  signIn(email: string, password: string): Promise<FlowResult>;
  forgot(email: string): Promise<FlowResult>;
  reset(email: string, code: string, password: string): Promise<FlowResult>;
}

export function createEmailFlows(identity: IdentityClient, now = nowSeconds): EmailFlows {
  /** Cognito's sign-up session, kept in memory only, so verifying signs straight in. */
  const sessions = new Map<string, string>();

  return {
    async signUp(rawEmail, password) {
      const input = signUpSchema.safeParse({ email: rawEmail, password });
      if (!input.success) {
        return fail(
          input.error.issues[0]?.path[0] === 'password' ? 'InvalidPassword' : 'InvalidParameter',
        );
      }
      const { email } = input.data;
      try {
        const out = await identity.signUp(email, password);
        if (out.session) sessions.set(email, out.session);
        return { kind: 'next', route: '/verify', email };
      } catch (err) {
        return caught(err);
      }
    },

    async verify(rawEmail, rawCode) {
      const input = confirmSignUpSchema.safeParse({ email: rawEmail, code: rawCode });
      if (!input.success) return fail('InvalidParameter');
      const { email, code } = input.data;
      let next: { session?: string };
      try {
        next = await identity.confirmSignUp(email, code, sessions.get(email));
      } catch (err) {
        return caught(err);
      }
      sessions.delete(email);
      if (next.session) {
        try {
          return {
            kind: 'signedIn',
            tokens: storedTokens(await identity.signInAfterConfirm(email, next.session), now()),
          };
        } catch {
          // Confirmed anyway: the password sign-in works.
        }
      }
      return {
        kind: 'next',
        route: '/sign-in',
        email,
        notice: 'Your email is confirmed. Sign in to continue.',
      };
    },

    async resend(rawEmail) {
      const input = emailOnlySchema.safeParse({ email: rawEmail });
      if (!input.success) return fail('InvalidParameter');
      try {
        await identity.resendCode(input.data.email);
        return null;
      } catch (err) {
        return caught(err);
      }
    },

    async signIn(rawEmail, password) {
      const input = signInSchema.safeParse({ email: rawEmail, password });
      if (!input.success) return fail('InvalidParameter');
      try {
        const tokens = await identity.signInWithPassword(input.data.email, password);
        return { kind: 'signedIn', tokens: storedTokens(tokens, now()) };
      } catch (err) {
        return caught(err);
      }
    },

    async forgot(rawEmail) {
      const input = emailOnlySchema.safeParse({ email: rawEmail });
      if (!input.success) return fail('InvalidParameter');
      try {
        await identity.forgotPassword(input.data.email);
      } catch (err) {
        // Never reveal whether the email has an account.
        if (!(err instanceof IdentityError) || err.code !== 'NotAuthorized') return caught(err);
      }
      return { kind: 'next', route: '/reset', email: input.data.email };
    },

    async reset(rawEmail, rawCode, password) {
      const input = resetPasswordSchema.safeParse({ email: rawEmail, code: rawCode, password });
      if (!input.success) {
        return fail(
          input.error.issues[0]?.path[0] === 'password' ? 'InvalidPassword' : 'InvalidParameter',
        );
      }
      const { email, code } = input.data;
      try {
        await identity.confirmForgotPassword(email, code, password);
        return {
          kind: 'next',
          route: '/sign-in',
          email,
          notice: 'Your password is changed. Sign in with the new one.',
        };
      } catch (err) {
        return caught(err);
      }
    },
  };
}

export const IDENTITY_PROVIDER_LABELS = {
  Google: 'Continue with Google',
  SignInWithApple: 'Continue with Apple',
} as const;
export type IdentityProviderName = keyof typeof IDENTITY_PROVIDER_LABELS;

/** `EXPO_PUBLIC_IDENTITY_PROVIDERS=Google,SignInWithApple`; unknown names are dropped. */
export function parseProviders(value: string | undefined): IdentityProviderName[] {
  const names = (value ?? '').split(',').map((p) => p.trim());
  return (Object.keys(IDENTITY_PROVIDER_LABELS) as IdentityProviderName[]).filter((p) =>
    names.includes(p),
  );
}
