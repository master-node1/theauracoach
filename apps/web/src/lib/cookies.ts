/**
 * Cookie names and serialisation for the BFF. `__Host-` cookies must be Secure, Path=/ and have no
 * Domain, so the browser binds them to this exact origin. Browsers treat http://localhost as
 * secure, so the same flags work in local development.
 */
export const SESSION_COOKIE = '__Host-session';
export const REFRESH_COOKIE = '__Host-refresh';
export const FLOW_COOKIE = '__Host-auth-flow';
/** Set on sign out, cleared on sign in; holds no data. See resolveSession. */
export const SIGNED_OUT_COOKIE = '__Host-signed-out';

/** Matches Cognito's default refresh token lifetime. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
export const FLOW_MAX_AGE = 10 * 60;
/** Longer than any access token, which is the most a stray session cookie could live. */
export const SIGNED_OUT_MAX_AGE = 24 * 60 * 60;

export function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return serializeCookie(name, '', 0);
}

export function parseCookies(header: string | null): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    result.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return result;
}
