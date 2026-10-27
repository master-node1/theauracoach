import { envFlagDefaults } from '@aura/api-client';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** The Android emulator reaches the host machine at 10.0.2.2; the iOS simulator uses localhost. */
const localHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined> & {
  featureFlags?: Record<string, string | undefined>;
};

export const appConfig = {
  apiBaseUrl: extra.apiBaseUrl ?? `http://${localHost}:8080`,
  oidc: {
    domainUrl: extra.oidcDomainUrl ?? `http://${localHost}:4100`,
    clientId: extra.oidcClientId ?? 'aura-dev-client',
    scopes: ['openid', 'email', 'profile'],
  },
  /**
   * Flag values until `GET /v1/me/flags` answers, and whenever it cannot: catalogue defaults with
   * `EXPO_PUBLIC_FEATURE_<KEY>` overrides. Screens read flags with `useFlags()` (preferences.tsx).
   */
  flagDefaults: envFlagDefaults(extra.featureFlags ?? {}, 'EXPO_PUBLIC_FEATURE_'),
};
