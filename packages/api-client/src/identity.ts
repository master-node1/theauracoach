import { normaliseEmail, type IdentityErrorCode } from '@aura/contracts';

/**
 * Client for the identity provider's public user API: Cognito's `cognito-idp` JSON protocol
 * (`X-Amz-Target: AWSCognitoIdentityProviderService.<Action>`), which dev-auth also speaks. These
 * calls need no AWS credentials, only the app client id, so the web BFF and the mobile app use the
 * same code and switching between Cognito and dev-auth is a change of `endpoint` (TAC-8).
 */

export interface IdentityClientOptions {
  /** Cognito: `https://cognito-idp.<region>.amazonaws.com/`; dev-auth: `http://localhost:4100/`. */
  endpoint: string;
  clientId: string;
  /** Confidential clients (the web BFF) send a SECRET_HASH; public clients (mobile) have none. */
  clientSecret?: string;
  fetch?: typeof fetch;
}

export interface IdentityTokens {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  /** Seconds the access token is valid for. */
  expiresIn: number;
}

export interface IdentityClient {
  /** Registers the user and emails a code. `session` lets `signInAfterConfirm` skip the password. */
  signUp(email: string, password: string): Promise<{ confirmed: boolean; session?: string }>;
  confirmSignUp(email: string, code: string, session?: string): Promise<{ session?: string }>;
  resendCode(email: string): Promise<void>;
  /** Emails a reset code. Unknown emails succeed too, so the call never reveals who has an account. */
  forgotPassword(email: string): Promise<void>;
  confirmForgotPassword(email: string, code: string, password: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<IdentityTokens>;
  /** Cognito "sign in after sign-up": exchanges the session from `confirmSignUp` for tokens. */
  signInAfterConfirm(email: string, session: string): Promise<IdentityTokens>;
  /** Ends every session of the user: refresh tokens stop working on all devices. */
  globalSignOut(accessToken: string): Promise<void>;
}

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'IdentityError';
  }
}

const EXCEPTION_CODES: Record<string, IdentityErrorCode> = {
  UsernameExistsException: 'UsernameExists',
  AliasExistsException: 'UsernameExists',
  CodeMismatchException: 'CodeMismatch',
  ExpiredCodeException: 'ExpiredCode',
  LimitExceededException: 'LimitExceeded',
  TooManyFailedAttemptsException: 'LimitExceeded',
  TooManyRequestsException: 'TooManyRequests',
  InvalidPasswordException: 'InvalidPassword',
  NotAuthorizedException: 'NotAuthorized',
  UserNotFoundException: 'NotAuthorized',
  UserNotConfirmedException: 'UserNotConfirmed',
  InvalidParameterException: 'InvalidParameter',
  CodeDeliveryFailureException: 'Unavailable',
};

/** Maps an error response body (`{"__type": "…#CodeMismatchException"}`) to our code. */
export function identityErrorCode(type: unknown): IdentityErrorCode {
  if (typeof type !== 'string') return 'Unavailable';
  const name = type.slice(type.lastIndexOf('#') + 1);
  return EXCEPTION_CODES[name] ?? 'Unavailable';
}

/** Base64 HMAC-SHA256 of `username + clientId`, keyed with the client secret (Cognito SECRET_HASH). */
export async function secretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(clientSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, enc.encode(username + clientId)),
  );
  let binary = '';
  for (const b of mac) binary += String.fromCharCode(b);
  return btoa(binary);
}

interface AuthenticationResult {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
  ExpiresIn?: number;
}

function toTokens(body: { AuthenticationResult?: AuthenticationResult; ChallengeName?: string }) {
  const r = body.AuthenticationResult;
  // MFA and other challenges are not part of the email flows yet (admin MFA is TAC-9).
  if (!r?.AccessToken || !r.IdToken) throw new IdentityError('ChallengeRequired');
  return {
    accessToken: r.AccessToken,
    idToken: r.IdToken,
    ...(r.RefreshToken ? { refreshToken: r.RefreshToken } : {}),
    expiresIn: r.ExpiresIn ?? 3600,
  };
}

export function createIdentityClient(options: IdentityClientOptions): IdentityClient {
  const doFetch = options.fetch ?? fetch;
  const { clientId, clientSecret } = options;

  async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': `AWSCognitoIdentityProviderService.${action}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new IdentityError('Unavailable');
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new IdentityError(
        identityErrorCode(json.__type ?? res.headers.get('x-amzn-errortype')),
      );
    }
    return json as T;
  }

  async function withSecret(username: string): Promise<{ SecretHash?: string }> {
    return clientSecret ? { SecretHash: await secretHash(username, clientId, clientSecret) } : {};
  }

  return {
    async signUp(rawEmail, password) {
      const email = normaliseEmail(rawEmail);
      const out = await call<{ UserConfirmed?: boolean; Session?: string }>('SignUp', {
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }],
        ...(await withSecret(email)),
      });
      return {
        confirmed: out.UserConfirmed === true,
        ...(out.Session ? { session: out.Session } : {}),
      };
    },

    async confirmSignUp(rawEmail, code, session) {
      const email = normaliseEmail(rawEmail);
      const out = await call<{ Session?: string }>('ConfirmSignUp', {
        ClientId: clientId,
        Username: email,
        ConfirmationCode: code,
        ...(session ? { Session: session } : {}),
        ...(await withSecret(email)),
      });
      return out.Session ? { session: out.Session } : {};
    },

    async resendCode(rawEmail) {
      const email = normaliseEmail(rawEmail);
      await call('ResendConfirmationCode', {
        ClientId: clientId,
        Username: email,
        ...(await withSecret(email)),
      });
    },

    async forgotPassword(rawEmail) {
      const email = normaliseEmail(rawEmail);
      await call('ForgotPassword', {
        ClientId: clientId,
        Username: email,
        ...(await withSecret(email)),
      });
    },

    async confirmForgotPassword(rawEmail, code, password) {
      const email = normaliseEmail(rawEmail);
      await call('ConfirmForgotPassword', {
        ClientId: clientId,
        Username: email,
        ConfirmationCode: code,
        Password: password,
        ...(await withSecret(email)),
      });
    },

    async signInWithPassword(rawEmail, password) {
      const email = normaliseEmail(rawEmail);
      const secret = await withSecret(email);
      return toTokens(
        await call('InitiateAuth', {
          ClientId: clientId,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
            ...(secret.SecretHash ? { SECRET_HASH: secret.SecretHash } : {}),
          },
        }),
      );
    },

    async signInAfterConfirm(rawEmail, session) {
      const email = normaliseEmail(rawEmail);
      const secret = await withSecret(email);
      return toTokens(
        await call('InitiateAuth', {
          ClientId: clientId,
          AuthFlow: 'USER_AUTH',
          Session: session,
          AuthParameters: {
            USERNAME: email,
            ...(secret.SecretHash ? { SECRET_HASH: secret.SecretHash } : {}),
          },
        }),
      );
    },

    async globalSignOut(accessToken) {
      await call('GlobalSignOut', { AccessToken: accessToken });
    },
  };
}

/** What the apps show for each error code: plain words, no provider names. */
export const IDENTITY_ERROR_MESSAGES: Record<IdentityErrorCode, string> = {
  UsernameExists: 'An account with this email already exists. Sign in or reset your password.',
  CodeMismatch: 'That code is not right. Check the email and try again.',
  ExpiredCode: 'That code has expired. Send a new one and try again.',
  LimitExceeded: 'Too many attempts. Wait a few minutes and try again.',
  TooManyRequests: 'Too many attempts. Wait a minute and try again.',
  InvalidPassword: 'Use at least 10 characters with upper- and lower-case letters and a number.',
  NotAuthorized: 'That email and password do not match.',
  UserNotConfirmed: 'Confirm your email first. We can send a new code.',
  InvalidParameter: 'Check the details and try again.',
  ChallengeRequired: 'This account needs another sign-in step. Use “More sign-in options”.',
  Unavailable: 'We could not reach the sign-in service. Try again in a moment.',
};

export function identityErrorMessage(code: string | undefined): string {
  return IDENTITY_ERROR_MESSAGES[code as IdentityErrorCode] ?? IDENTITY_ERROR_MESSAGES.Unavailable;
}

export {
  AUTH_CODE_TTL_SECONDS,
  PASSWORD_POLICY,
  authCodeSchema,
  confirmSignUpSchema,
  emailOnlySchema,
  emailSchema,
  isIdentityErrorCode,
  normaliseEmail,
  passwordHint,
  passwordIssues,
  passwordProblems,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  type IdentityErrorCode,
  type PasswordIssue,
} from '@aura/contracts';
