import type { ExpoConfig } from 'expo/config';

/**
 * Env-driven so the same build can point at the local stack or a deployed one (TAC-2). The
 * runtime reads these through expo-constants (src/config.ts); unset values fall back to the
 * local docker compose stack.
 */
const config: ExpoConfig = {
  name: 'AuraCoach',
  slug: 'auracoach',
  version: '0.1.0',
  scheme: 'auracoach',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: { bundleIdentifier: 'com.auracoach.app', supportsTablet: true },
  android: { package: 'com.auracoach.app' },
  plugins: ['expo-router', 'expo-secure-store', 'expo-web-browser'],
  experiments: { typedRoutes: false },
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
    oidcDomainUrl: process.env.EXPO_PUBLIC_OIDC_DOMAIN_URL,
    oidcClientId: process.env.EXPO_PUBLIC_OIDC_CLIENT_ID,
  },
};

export default config;
