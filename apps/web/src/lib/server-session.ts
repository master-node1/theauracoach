import { cookies } from 'next/headers';
import { createApiClient, type ApiClient } from '@aura/api-client';
import { config } from './config';
import { SESSION_COOKIE } from './cookies';
import { idTokenVerifier } from './oidc';
import { readSession, type Session } from './session';
import type { AuthDeps } from './auth-handlers';

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

export function authDeps(): AuthDeps {
  const cfg = config();
  return { config: cfg, verifyIdToken: idTokenVerifier(cfg) };
}
