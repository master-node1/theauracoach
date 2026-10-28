import type { WebConfig } from './config';

/**
 * Per-IP limit for the BFF's auth routes: 10 requests a minute (security architecture §5). Kept in
 * memory, so each web replica counts on its own; Cognito's own per-account limits sit behind it.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Null when the request may go ahead, else a 429 problem with Retry-After. */
  check(request: Request, config: WebConfig): Response | null {
    const t = this.now();
    const key = clientIp(request, config.trustedProxyHops);
    let window = this.windows.get(key);
    if (!window || t - window.start >= 60_000) {
      window = { start: t, count: 0 };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.prune(t);
    }
    window.count += 1;
    if (window.count <= config.authRateLimitPerMinute) return null;
    const retryAfter = Math.max(1, Math.ceil((window.start + 60_000 - t) / 1000));
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Too many attempts',
        status: 429,
        code: 'TooManyRequests',
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/problem+json',
          'cache-control': 'no-store',
          'retry-after': String(retryAfter),
        },
      },
    );
  }

  private prune(t: number) {
    for (const [key, w] of this.windows) if (t - w.start >= 60_000) this.windows.delete(key);
  }
}

/**
 * The client address as our own proxies saw it: counting `hops` entries from the right of
 * X-Forwarded-For, because entries further left are whatever the client chose to send.
 */
export function clientIp(request: Request, hops: number): string {
  const entries = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  return entries[entries.length - hops] ?? entries[0] ?? 'unknown';
}
