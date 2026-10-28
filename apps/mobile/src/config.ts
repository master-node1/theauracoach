import { envFlagDefaults } from '@aura/api-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { parseProviders } from './auth/email-flows';

/** The Android emulator reaches the host machine at 10.0.2.2; the iOS simulator uses localhost. */
const localHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined> & {
  featureFlags?: Record<string, string | undefined>;
};
const oidcDomainUrl = extra.oidcDomainUrl ?? `http://${localHost}:4100`;

export const appConfig = {
  apiBaseUrl: extra.apiBaseUrl ?? `http://${localHost}:8080`,
  oidc: {
    domainUrl: oidcDomainUrl,
    clientId: extra.oidcClientId ?? 'aura-dev-client',
    scopes: ['openid', 'email', 'profile'],
  },
  /**
   * Flag values until `GET /v1/me/flags` answers, and whenever it cannot: catalogue defaults with
   * `EXPO_PUBLIC_FEATURE_<KEY>` overrides. Screens read flags with `useFlags()` (preferences.tsx).
   */
  flagDefaults: envFlagDefaults(extra.featureFlags ?? {}, 'EXPO_PUBLIC_FEATURE_'),
  /** Cognito's user API for email sign-up and reset; dev-auth serves the same API locally. */
  identityEndpoint: extra.identityEndpoint ?? `${oidcDomainUrl}/`,
  /** Google / Apple buttons, shown only for providers configured here. */
  identityProviders: parseProviders(extra.identityProviders),
};
