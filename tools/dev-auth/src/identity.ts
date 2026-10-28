import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  AUTH_CODE_TTL_SECONDS,
  normaliseEmail,
  passwordProblems,
  PASSWORD_POLICY,
} from '@aura/contracts';
import { jwtVerify } from 'jose';
import type { DevIssuer } from './index';
import type { createOAuthHandlers, DevUser, OAuthResult } from './oauth';
import { devUserId } from './oauth';

/**
 * The part of Cognito's `cognito-idp` JSON API that the apps' email flows use (TAC-8): SignUp,
 * ConfirmSignUp, ResendConfirmationCode, ForgotPassword, ConfirmForgotPassword, InitiateAuth
 * (USER_PASSWORD_AUTH and USER_AUTH with the sign-up session) and GlobalSignOut. Same request and
 * error shapes as Cognito, so `@aura/api-client`'s identity client works against either.
 *
 * Codes are printed to the log and readable from `GET /test/codes` instead of being emailed.
 */

export interface IdentityOptions {
  now?: () => number;
  log?: (line: string) => void;
}

interface Account {
  user: DevUser;
  salt: Buffer;
  hash: Buffer;
  confirmed: boolean;
}

interface PendingCode {
  code: string;
  expiresAt: number;
  failures: number;
}

interface SignUpSession {
  email: string;
  confirmed: boolean;
  expiresAt: number;
}

/** Wrong guesses allowed per code before Cognito answers LimitExceededException. */
export const MAX_CODE_FAILURES = 5;
/** Codes sent per email per 15 minutes before resends are refused. */
export const MAX_CODES_PER_WINDOW = 5;
/** Cognito's sign-up session lasts 3 minutes by default. */
const SESSION_TTL_MS = 3 * 60_000;
const WINDOW_MS = 15 * 60_000;

export class CognitoError extends Error {
  constructor(
    readonly type: string,
    message: string,
  ) {
    super(message);
  }
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

function body(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function createIdentityHandlers(
  dev: DevIssuer,
  oauth: ReturnType<typeof createOAuthHandlers>,
  options: IdentityOptions = {},
) {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.log(line));
  const accounts = new Map<string, Account>();
  const signUpCodes = new Map<string, PendingCode>();
  const resetCodes = new Map<string, PendingCode>();
  const sent = new Map<string, number[]>();
  const sessions = new Map<string, SignUpSession>();

  function fail(type: string, message: string): never {
    throw new CognitoError(type, message);
  }

  function checkPassword(password: string) {
    if (passwordProblems(password).length > 0 || password.length > PASSWORD_POLICY.maxLength) {
      fail('InvalidPasswordException', 'Password does not conform to policy');
    }
  }

  function checkClient(b: Record<string, unknown>) {
    if (!oauth.clientAllowed(str(b.ClientId))) {
      fail('ResourceNotFoundException', 'User pool client does not exist');
    }
  }

  function username(value: unknown): string {
    const email = normaliseEmail(str(value));
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) fail('InvalidParameterException', 'Invalid email');
    return email;
  }

  function issueCode(store: Map<string, PendingCode>, email: string, kind: string) {
    const t = now();
    const recent = (sent.get(email) ?? []).filter((at) => t - at < WINDOW_MS);
    if (recent.length >= MAX_CODES_PER_WINDOW) {
      fail('LimitExceededException', 'Attempt limit exceeded, please try after some time');
    }
    sent.set(email, [...recent, t]);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    store.set(email, { code, expiresAt: t + AUTH_CODE_TTL_SECONDS * 1000, failures: 0 });
    log(`[dev-auth] ${kind} code for ${email}: ${code}`);
  }

  /** Single use: a right code is consumed, a wrong one counts towards the limit. */
  function useCode(store: Map<string, PendingCode>, email: string, code: string) {
    const pending = store.get(email);
    if (!pending)
      fail('ExpiredCodeException', 'Invalid code provided, please request a code again');
    if (pending.failures >= MAX_CODE_FAILURES) {
      fail('LimitExceededException', 'Attempt limit exceeded, please try after some time');
    }
    if (pending.expiresAt < now()) {
      store.delete(email);
      fail('ExpiredCodeException', 'Invalid code provided, please request a code again');
    }
    const a = Buffer.from(pending.code);
    const b = Buffer.from(code);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      pending.failures += 1;
      fail('CodeMismatchException', 'Invalid verification code provided, please try again');
    }
    store.delete(email);
  }

  function newSession(email: string, confirmed: boolean): string {
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { email, confirmed, expiresAt: now() + SESSION_TTL_MS });
    return token;
  }

  const actions: Record<string, (b: Record<string, unknown>) => Promise<unknown> | unknown> = {
    SignUp(b) {
      checkClient(b);
      const email = username(b.Username);
      const password = str(b.Password);
      checkPassword(password);
      if (accounts.has(email)) fail('UsernameExistsException', 'User already exists');
      const salt = randomBytes(16);
      const sub = devUserId(email);
      accounts.set(email, {
        user: { sub, email, amr: ['pwd'] },
        salt,
        hash: hashPassword(password, salt),
        confirmed: false,
      });
      issueCode(signUpCodes, email, 'sign-up');
      return {
        UserConfirmed: false,
        UserSub: sub,
        Session: newSession(email, false),
        CodeDeliveryDetails: { DeliveryMedium: 'EMAIL', AttributeName: 'email' },
      };
    },

    ConfirmSignUp(b) {
      checkClient(b);
      const email = username(b.Username);
      const account = accounts.get(email);
      if (!account)
        fail('ExpiredCodeException', 'Invalid code provided, please request a code again');
      if (account.confirmed)
        fail('NotAuthorizedException', 'User cannot be confirmed. Current status is CONFIRMED');
      useCode(signUpCodes, email, str(b.ConfirmationCode));
      account.confirmed = true;
      const previous = sessions.get(str(b.Session));
      sessions.delete(str(b.Session));
      // Only the session from this user's SignUp carries over to sign-in.
      if (previous && previous.email === email && previous.expiresAt >= now()) {
        return { Session: newSession(email, true) };
      }
      return {};
    },

    ResendConfirmationCode(b) {
      checkClient(b);
      const email = username(b.Username);
      const account = accounts.get(email);
      if (account && !account.confirmed) issueCode(signUpCodes, email, 'sign-up');
      return { CodeDeliveryDetails: { DeliveryMedium: 'EMAIL', AttributeName: 'email' } };
    },

    ForgotPassword(b) {
      checkClient(b);
      const email = username(b.Username);
      // Like a pool with PreventUserExistenceErrors: unknown emails get the same answer.
      if (accounts.get(email)?.confirmed) issueCode(resetCodes, email, 'password reset');
      return { CodeDeliveryDetails: { DeliveryMedium: 'EMAIL', AttributeName: 'email' } };
    },

    ConfirmForgotPassword(b) {
      checkClient(b);
      const email = username(b.Username);
      const password = str(b.Password);
      checkPassword(password);
      const account = accounts.get(email);
      if (!account)
        fail('ExpiredCodeException', 'Invalid code provided, please request a code again');
      useCode(resetCodes, email, str(b.ConfirmationCode));
      account.salt = randomBytes(16);
      account.hash = hashPassword(password, account.salt);
      return {};
    },

    async InitiateAuth(b) {
      checkClient(b);
      const clientId = str(b.ClientId);
      const params = body(b.AuthParameters);
      const email = username(params.USERNAME);
      const account = accounts.get(email);
      if (b.AuthFlow === 'USER_PASSWORD_AUTH') {
        const ok =
          account &&
          timingSafeEqual(hashPassword(str(params.PASSWORD), account.salt), account.hash);
        if (!account || !ok) fail('NotAuthorizedException', 'Incorrect username or password.');
        if (!account.confirmed) fail('UserNotConfirmedException', 'User is not confirmed.');
        return { AuthenticationResult: await tokens(clientId, account.user) };
      }
      if (b.AuthFlow === 'USER_AUTH') {
        const session = sessions.get(str(b.Session));
        sessions.delete(str(b.Session));
        if (
          !account ||
          !session ||
          !session.confirmed ||
          session.email !== email ||
          session.expiresAt < now()
        ) {
          fail('NotAuthorizedException', 'Invalid session for the user, session is expired.');
        }
        return { AuthenticationResult: await tokens(clientId, account.user) };
      }
      return fail('InvalidParameterException', 'Unsupported AuthFlow');
    },

    async GlobalSignOut(b) {
      let sub: string;
      try {
        const { payload } = await jwtVerify(str(b.AccessToken), dev.keySource, {
          issuer: dev.issuer,
        });
        if (payload.token_use !== 'access' || typeof payload.sub !== 'string') throw new Error();
        sub = payload.sub;
      } catch {
        return fail('NotAuthorizedException', 'Invalid Access Token');
      }
      oauth.revokeAllFor(sub);
      return {};
    },
  };

  async function tokens(clientId: string, user: DevUser) {
    const t = await oauth.issueTokens(clientId, user);
    return {
      AccessToken: t.access_token,
      IdToken: t.id_token,
      RefreshToken: t.refresh_token,
      ExpiresIn: t.expires_in,
      TokenType: 'Bearer',
    };
  }

  return {
    /** POST / with `X-Amz-Target: AWSCognitoIdentityProviderService.<Action>`. */
    async handle(target: string | undefined, input: unknown): Promise<OAuthResult> {
      const action = (target ?? '').replace(/^AWSCognitoIdentityProviderService\./, '');
      const headers = {
        'content-type': 'application/x-amz-json-1.1',
        'access-control-allow-origin': '*',
      };
      const handler = Object.hasOwn(actions, action) ? actions[action] : undefined;
      try {
        if (!handler) fail('UnknownOperationException', `Unknown operation ${action}`);
        const out = await handler(body(input));
        return { status: 200, headers, body: JSON.stringify(out) };
      } catch (err) {
        if (!(err instanceof CognitoError)) throw err;
        return {
          status: 400,
          headers: { ...headers, 'x-amzn-errortype': err.type },
          body: JSON.stringify({ __type: err.type, message: err.message }),
        };
      }
    },

    /** Test-only: the codes waiting for an email, so automated tests can read their "inbox". */
    pendingCodes(rawEmail: string): { signUp?: string; reset?: string } {
      const email = normaliseEmail(rawEmail);
      const signUp = signUpCodes.get(email)?.code;
      const reset = resetCodes.get(email)?.code;
      return { ...(signUp ? { signUp } : {}), ...(reset ? { reset } : {}) };
    },
  };
}
