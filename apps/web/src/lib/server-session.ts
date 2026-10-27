import { cookies } from 'next/headers';
import { cache } from 'react';
import {
  createApiClient,
  loadFlags,
  type ApiClient,
  type FlagValues,
  type MeResponse,
} from '@aura/api-client';
import { config } from './config';
import { flagDefaults } from './features';
import { SESSION_COOKIE } from './cookies';
import { idTokenVerifier } from './oidc';
import { readSession, type Session } from './session';
import type { AuthDeps } from './auth-handlers';
import type { EmailAuthDeps } from './email-auth';
import { RateLimiter } from './rate-limit';

/** One budget per server process for every rate-limited auth route. */
const authLimiter = new RateLimiter();

/** The current request's session. proxy.ts has already refreshed it if needed. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return readSession(config(), jar.get(SESSION_COOKIE)?.value);
}

/** API client for server components, calling the gateway directly with the user's token. */
export function serverApi(session: Session): ApiClient {
  return createApiClient({
    baseUrl: config().apiBaseUrl,
    getAccessToken: () => session.accessToken,
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  });
}

/** `/v1/me` for the current request, fetched once however many components ask; null on failure. */
export const currentMe = cache(async (): Promise<MeResponse | null> => {
  const session = await currentSession();
  if (!session) return null;
  return serverApi(session)
    .me()
    .catch(() => null);
});

/** The current user's feature flags, fetched once per request; env defaults when the API fails. */
export const currentFlags = cache(async (): Promise<FlagValues> => {
  const session = await currentSession();
  if (!session) return flagDefaults();
  return loadFlags(serverApi(session), flagDefaults());
});

export function authDeps(): AuthDeps {
  const cfg = config();
  return { config: cfg, verifyIdToken: idTokenVerifier(cfg), limiter: authLimiter };
}

export function emailAuthDeps(): EmailAuthDeps {
  return authDeps();
}
