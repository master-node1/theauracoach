import { trimTrailingSlashes } from '@aura/api-client';

/**
 * Server-side settings for the BFF. Everything that differs between dev-auth and Cognito is here,
 * so switching providers is an env change (TAC-2). Read lazily: `next build` has no runtime env.
 */
export interface WebConfig {
  /** Public origin of this app, e.g. http://localhost:3100. Used for redirects and the CSRF check. */
  appUrl: string;
  /** Gateway origin the BFF forwards /api/v1/* to. */
  apiBaseUrl: string;
  oidc: {
    /** Hosted UI / OAuth domain: Cognito `https://<domain>.auth.<region>.amazoncognito.com`, or dev-auth. */
    domainUrl: string;
    /** Token issuer; its JWKS lives at `${issuer}/.well-known/jwks.json`. */
    issuer: string;
    clientId: string;
    clientSecret?: string;
    scopes: string;
  };
  /** Cognito's user API for the email flows (TAC-8); dev-auth serves the same API locally. */
  identityEndpoint: string;
  /**
   * Federated providers to offer as buttons, by their Cognito names (`Google`, `SignInWithApple`).
   * Empty hides the buttons; a provider is listed only once its IdP app exists.
   */
  identityProviders: IdentityProviderName[];
  /** Auth form posts allowed per client IP per minute (security architecture §5). */
  authRateLimitPerMinute: number;
  /** Proxies in front of the app that append to X-Forwarded-For (ingress, CloudFront). */
  trustedProxyHops: number;
  /** At least 32 characters; encrypts the session cookies. */
  sessionSecret: string;
  /** Grafana panels the admin usage page embeds (error rate, latency); empty hides them. */
  grafanaPanels: GrafanaPanel[];
}

export interface GrafanaPanel {
  title: string;
  url: string;
}

/**
 * `ADMIN_GRAFANA_PANELS`: `Title|https://grafana.example/d-solo/...,Title 2|https://...`.
 * Only http(s) URLs are kept; anything else is dropped rather than embedded.
 */
export function parseGrafanaPanels(value: string | undefined): GrafanaPanel[] {
  if (!value) return [];
  const panels: GrafanaPanel[] = [];
  for (const item of value.split(',')) {
    const bar = item.indexOf('|');
    if (bar < 1) continue;
    const title = item.slice(0, bar).trim();
    const url = item.slice(bar + 1).trim();
    try {
      const parsed = new URL(url);
      if (title && (parsed.protocol === 'https:' || parsed.protocol === 'http:')) {
        panels.push({ title, url: parsed.toString() });
      }
    } catch {
      // not a URL: skip it
    }
  }
  return panels;
}

export const IDENTITY_PROVIDER_NAMES = ['Google', 'SignInWithApple'] as const;
export type IdentityProviderName = (typeof IDENTITY_PROVIDER_NAMES)[number];

export function parseProviders(value: string | undefined): IdentityProviderName[] {
  const names = (value ?? '').split(',').map((p) => p.trim());
  return IDENTITY_PROVIDER_NAMES.filter((p) => names.includes(p));
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const DEV_SESSION_SECRET = 'local-development-only-session-key-change-me';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const production = env.NODE_ENV === 'production';
  const get = (name: string, fallback: string): string => {
    const value = env[name];
    if (value) return trimTrailingSlashes(value);
    if (production) throw new Error(`${name} must be set`);
    return fallback;
  };
  const sessionSecret = get('SESSION_SECRET', DEV_SESSION_SECRET);
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const domainUrl = get('OIDC_DOMAIN_URL', 'http://localhost:4100');
  return {
    appUrl: get('APP_URL', 'http://localhost:3100'),
    apiBaseUrl: get('API_BASE_URL', 'http://localhost:8080'),
    oidc: {
      domainUrl,
      issuer: get('OIDC_ISSUER', domainUrl),
      clientId: get('OIDC_CLIENT_ID', 'aura-dev-client'),
      clientSecret: env.OIDC_CLIENT_SECRET || undefined,
      scopes: env.OIDC_SCOPES || 'openid email profile',
    },
    identityEndpoint: get('IDENTITY_ENDPOINT', `${domainUrl}/`),
    identityProviders: parseProviders(env.IDENTITY_PROVIDERS),
    authRateLimitPerMinute: positiveInt(env.AUTH_RATE_LIMIT_PER_MINUTE, 10),
    trustedProxyHops: positiveInt(env.TRUSTED_PROXY_HOPS, 1),
    sessionSecret,
    grafanaPanels: parseGrafanaPanels(env.ADMIN_GRAFANA_PANELS),
  };
}

let cached: WebConfig | undefined;

/** Config for the running server, read once. */
export function config(): WebConfig {
  cached ??= loadConfig();
  return cached;
}
