import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { appConfig } from '../config';
import { clearTokens, loadTokens, saveTokens } from './storage';
import { fromTokenResult, needsRefresh, singleFlight, type StoredTokens } from './tokens';

// Closes the in-app browser when the OAuth redirect comes back (needed on web, harmless native).
WebBrowser.maybeCompleteAuthSession();

const { domainUrl, clientId, scopes } = appConfig.oidc;

/** Cognito's hosted endpoints; dev-auth serves the same paths locally. */
const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `${domainUrl}/oauth2/authorize`,
  tokenEndpoint: `${domainUrl}/oauth2/token`,
  revocationEndpoint: `${domainUrl}/oauth2/revoke`,
  endSessionEndpoint: `${domainUrl}/logout`,
};

const redirectUri = AuthSession.makeRedirectUri({ scheme: 'auracoach', path: 'callback' });
const signedOutUri = AuthSession.makeRedirectUri({ scheme: 'auracoach', path: 'signed-out' });

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: Status;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** A fresh access token, refreshing first when under 60 s remain; null when signed out. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const tokens = useRef<StoredTokens | null>(null);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    { clientId, redirectUri, scopes, usePKCE: true },
    discovery,
  );

  const store = useCallback(async (next: StoredTokens | null) => {
    tokens.current = next;
    if (next) await saveTokens(next);
    else await clearTokens();
    setStatus(next ? 'signedIn' : 'signedOut');
  }, []);

  useEffect(() => {
    loadTokens()
      .then((saved) => {
        tokens.current = saved;
        setStatus(saved ? 'signedIn' : 'signedOut');
      })
      .catch(() => setStatus('signedOut'));
  }, []);

  // The authorization response: exchange the code (with the PKCE verifier) for tokens.
  useEffect(() => {
    if (!response || !request) return;
    if (response.type === 'error') {
      setError('Sign-in failed. Please try again.');
      return;
    }
    if (response.type !== 'success') return;
    const code = response.params.code;
    if (!code || !request.codeVerifier) return;
    AuthSession.exchangeCodeAsync(
      { clientId, code, redirectUri, extraParams: { code_verifier: request.codeVerifier } },
      discovery,
    )
      .then((result) => store(fromTokenResult(result, null)))
      .then(() => setError(null))
      .catch(() => setError('We could not finish signing you in. Please try again.'));
  }, [response, request, store]);

  const refresh = useMemo(
    () =>
      singleFlight(async () => {
        const current = tokens.current;
        if (!current) return null;
        try {
          const result = await AuthSession.refreshAsync(
            { clientId, refreshToken: current.refreshToken },
            discovery,
          );
          const next = fromTokenResult(result, current.refreshToken);
          await store(next);
          return next;
        } catch {
          // Refresh token revoked or expired: back to sign-in.
          await store(null);
          return null;
        }
      }),
    [store],
  );

  const getAccessToken = useCallback(async () => {
    const current = tokens.current;
    if (!current) return null;
    if (!needsRefresh(current)) return current.accessToken;
    return (await refresh())?.accessToken ?? null;
  }, [refresh]);

  const signIn = useCallback(async () => {
    setError(null);
    await promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    const current = tokens.current;
    await store(null);
    if (current) {
      await AuthSession.revokeAsync(
        {
          clientId,
          token: current.refreshToken,
          tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken,
        },
        discovery,
      ).catch(() => undefined);
    }
    // End the hosted-UI session too, so the next sign-in asks again.
    const logout = `${discovery.endSessionEndpoint}?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(signedOutUri)}`;
    await WebBrowser.openAuthSessionAsync(logout, signedOutUri).catch(() => undefined);
  }, [store]);

  const value = useMemo(
    () => ({ status, error, signIn, signOut, getAccessToken }),
    [status, error, signIn, signOut, getAccessToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
