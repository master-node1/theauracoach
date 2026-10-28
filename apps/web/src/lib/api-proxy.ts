import type { WebConfig } from './config';
import { isSameOrigin } from './csrf';
import type { Session } from './session';

/** Request headers passed through to the gateway; everything else (cookies included) stays here. */
const FORWARD_REQUEST = [
  'accept',
  'accept-language',
  'content-type',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'x-request-id',
];
const FORWARD_RESPONSE = [
  'content-disposition',
  'content-type',
  'etag',
  'location',
  'retry-after',
  'x-request-id',
];

function problem(status: number, code: string, title: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title, status, code }), {
    status,
    headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
  });
}

/**
 * /api/v1/* -> gateway /v1/*, with the session's access token as the bearer. proxy.ts has already
 * refreshed the session, so `session` is fresh or null.
 */
export async function forwardToApi(
  request: Request,
  path: readonly string[],
  session: Session | null,
  config: WebConfig,
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  if (!isSameOrigin(request, config)) return problem(403, 'CSRF', 'Cross-origin request refused');
  if (!session) return problem(401, 'UNAUTHENTICATED', 'Sign in again');

  const target = new URL(
    `${config.apiBaseUrl}/v1/${path.map(encodeURIComponent).join('/')}${new URL(request.url).search}`,
  );
  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set('authorization', `Bearer ${session.accessToken}`);
  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let upstream: Response;
  try {
    upstream = await doFetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return problem(502, 'UPSTREAM_UNAVAILABLE', 'The API is unreachable');
  }
  const out = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
