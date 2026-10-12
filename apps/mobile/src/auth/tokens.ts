/**
 * Token bookkeeping with no React Native imports, so it can be unit tested. The provider
 * (AuthProvider.tsx) does the I/O.
 */

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token expiry, epoch seconds. */
  expiresAt: number;
}

/** Same rule as the web BFF: refresh when under 60 s remain. */
export const REFRESH_LEEWAY_SECONDS = 60;

/** Secure-store keys; values are stored separately to stay under the 2 KB per-item guidance. */
export const STORE_KEYS = {
  access: 'aura.accessToken',
  refresh: 'aura.refreshToken',
  expiresAt: 'aura.expiresAt',
} as const;

export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  issuedAt?: number;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Builds the stored token set from a token response. A refresh response may carry no refresh
 * token (Cognito without rotation), so the previous one is kept.
 */
export function fromTokenResult(
  result: TokenResult,
  previousRefreshToken: string | null,
  now = nowSeconds(),
): StoredTokens {
  const refreshToken = result.refreshToken ?? previousRefreshToken;
  if (!refreshToken) throw new Error('no refresh token');
  return {
    accessToken: result.accessToken,
    refreshToken,
    expiresAt: (result.issuedAt ?? now) + (result.expiresIn ?? 3600),
  };
}

export function needsRefresh(tokens: StoredTokens, now = nowSeconds()): boolean {
  return tokens.expiresAt - now <= REFRESH_LEEWAY_SECONDS;
}

export function serialize(tokens: StoredTokens): Record<string, string> {
  return {
    [STORE_KEYS.access]: tokens.accessToken,
    [STORE_KEYS.refresh]: tokens.refreshToken,
    [STORE_KEYS.expiresAt]: String(tokens.expiresAt),
  };
}

export function deserialize(values: Record<string, string | null>): StoredTokens | null {
  const accessToken = values[STORE_KEYS.access];
  const refreshToken = values[STORE_KEYS.refresh];
  const expiresAt = Number(values[STORE_KEYS.expiresAt]);
  if (!accessToken || !refreshToken || !Number.isFinite(expiresAt)) return null;
  return { accessToken, refreshToken, expiresAt };
}

/** Runs `fn` once at a time: concurrent callers share the in-flight refresh. */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    inFlight ??= fn().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
