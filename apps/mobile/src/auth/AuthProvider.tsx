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

export type HostedSignInError = 'provider' | 'tokens';

interface AuthContextValue {
  status: Status;
  /** Why the hosted sign-in failed, as a key under `auth.errors`. */
  error: HostedSignInError | null;
  /** Hosted sign-in; with a provider it goes straight to Google or Apple. */
  signIn: (provider?: IdentityProviderName) => Promise<void>;
  /** Stores tokens from an email flow (sign-in, or verify after sign-up). */
  completeSignIn: (tokens: StoredTokens) => Promise<void>;
  emailFlows: EmailFlows;
  signOut: () => Promise<void>;
  /** Ends every session of the user (TAC-8). False when the API could not do it. */
  signOutEverywhere: () => Promise<boolean>;
  /** Signs in again (account deletion needs a recent sign-in); false when the user backs out. */
  reauthenticate: () => Promise<boolean>;
  /** A fresh access token, refreshing first when under 60 s remain; null when signed out. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<HostedSignInError | null>(null);
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
        setError('provider');
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
        setError('tokens');
      }
    },
    [store],
  );

  /** The hosted page must ask for the password again, even when signed in (users LLD §4). */
  const reauthenticate = useCallback(async () => {
    const request = new AuthSession.AuthRequest({
      clientId,
      redirectUri,
      scopes,
      usePKCE: true,
      prompt: AuthSession.Prompt.Login,
      extraParams: { max_age: '0' },
    });
    const response = await request.promptAsync(discovery);
    const code = response.type === 'success' ? response.params.code : undefined;
    if (!code || !request.codeVerifier) return false;
    try {
      const result = await AuthSession.exchangeCodeAsync(
        { clientId, code, redirectUri, extraParams: { code_verifier: request.codeVerifier } },
        discovery,
      );
      await store(fromTokenResult(result, tokens.current?.refreshToken ?? null));
      return true;
    } catch {
      return false;
    }
  }, [store]);

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
      reauthenticate,
      getAccessToken,
    }),
    [
      status,
      error,
      signIn,
      completeSignIn,
      signOut,
      signOutEverywhere,
      reauthenticate,
      getAccessToken,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
