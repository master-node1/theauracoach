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
import { createApiClient, createIdentityClient } from '@aura/api-client';
import { appConfig } from '../config';
import { createEmailFlows, type EmailFlows, type IdentityProviderName } from './email-flows';
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

/** Email flows talk to Cognito (or dev-auth) directly; one instance keeps sign-up sessions. */
const emailFlows = createEmailFlows(
  createIdentityClient({ endpoint: appConfig.identityEndpoint, clientId }),
);

interface AuthContextValue {
  status: Status;
  error: string | null;
  /** Hosted sign-in; with a provider it goes straight to Google or Apple. */
  signIn: (provider?: IdentityProviderName) => Promise<void>;
  /** Stores tokens from an email flow (sign-in, or verify after sign-up). */
  completeSignIn: (tokens: StoredTokens) => Promise<void>;
  emailFlows: EmailFlows;
  signOut: () => Promise<void>;
  /** Ends every session of the user (TAC-8). False when the API could not do it. */
  signOutEverywhere: () => Promise<boolean>;
  /** A fresh access token, refreshing first when under 60 s remain; null when signed out. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const tokens = useRef<StoredTokens | null>(null);

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

  /** Authorization Code + PKCE in the system browser, then the code exchange. */
  const signIn = useCallback(
    async (provider?: IdentityProviderName) => {
      setError(null);
      const request = new AuthSession.AuthRequest({
        clientId,
        redirectUri,
        scopes,
        usePKCE: true,
        ...(provider ? { extraParams: { identity_provider: provider } } : {}),
      });
      const response = await request.promptAsync(discovery);
      if (response.type === 'error') {
        setError('Sign-in failed. Please try again.');
        return;
      }
      if (response.type !== 'success') return;
      const code = response.params.code;
      if (!code || !request.codeVerifier) return;
      try {
        const result = await AuthSession.exchangeCodeAsync(
          { clientId, code, redirectUri, extraParams: { code_verifier: request.codeVerifier } },
          discovery,
        );
        await store(fromTokenResult(result, null));
      } catch {
        setError('We could not finish signing you in. Please try again.');
      }
    },
    [store],
  );

  const completeSignIn = useCallback(
    async (next: StoredTokens) => {
      setError(null);
      await store(next);
    },
    [store],
  );

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

  const signOutEverywhere = useCallback(async () => {
    const api = createApiClient({ baseUrl: appConfig.apiBaseUrl, getAccessToken });
    try {
      await api.revokeAllSessions();
    } catch {
      return false;
    }
    await signOut();
    return true;
  }, [getAccessToken, signOut]);

  const value = useMemo(
    () => ({
      status,
      error,
      signIn,
      completeSignIn,
      emailFlows,
      signOut,
      signOutEverywhere,
      getAccessToken,
    }),
    [status, error, signIn, completeSignIn, signOut, signOutEverywhere, getAccessToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
