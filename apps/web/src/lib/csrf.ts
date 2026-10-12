import type { WebConfig } from './config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF check for state-changing requests: the browser's Origin header must be this app. SameSite=Lax
 * already keeps the cookies off cross-site POSTs; this also covers same-site attackers and old
 * browsers. Requests without Origin are refused.
 */
export function isSameOrigin(request: Request, config: WebConfig): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(config.appUrl).origin;
}

/** Only local paths, so `returnTo` cannot send a user to another site after sign-in. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  if (value.startsWith('/api/') || value.startsWith('/auth/')) return '/';
  return value;
}
