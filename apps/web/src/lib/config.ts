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
  /** At least 32 characters; encrypts the session cookies. */
  sessionSecret: string;
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
    sessionSecret,
  };
}

let cached: WebConfig | undefined;

/** Config for the running server, read once. */
export function config(): WebConfig {
  cached ??= loadConfig();
  return cached;
}
