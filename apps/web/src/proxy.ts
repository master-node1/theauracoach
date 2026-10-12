import { NextResponse, type NextRequest } from 'next/server';
import { config as webConfig } from './lib/config';
import { SESSION_COOKIE } from './lib/cookies';
import { idTokenVerifier } from './lib/oidc';
import { isStaff, resolveSession } from './lib/session';

/**
 * Runs before every page and /api/v1 request: refreshes the session when the access token has
 * under 60 s left, sends signed-out visitors to sign-in, and keeps non-staff out of /admin.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const cfg = webConfig();
  const state = await resolveSession(cfg, request.headers.get('cookie'), {
    verifyIdToken: idTokenVerifier(cfg),
  });
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (state.kind === 'none') {
    const response = isApi
      ? NextResponse.json(
          { type: 'about:blank', title: 'Sign in again', status: 401, code: 'UNAUTHENTICATED' },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        )
      : NextResponse.redirect(
          new URL(`/auth/sign-in?returnTo=${encodeURIComponent(pathname + search)}`, cfg.appUrl),
        );
    for (const c of state.setCookies) response.headers.append('set-cookie', c);
    return response;
  }

  let response: NextResponse | undefined;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (!isStaff(state.session.groups)) {
      response = NextResponse.rewrite(new URL('/forbidden', request.url), { status: 403 });
    }
  }
  if (state.kind === 'refreshed') {
    // Let this request's server components and route handlers see the new session too.
    request.cookies.set(SESSION_COOKIE, state.sessionCookie);
  }
  response ??= NextResponse.next({ request: { headers: request.headers } });
  if (state.kind === 'refreshed') {
    for (const c of state.setCookies) response.headers.append('set-cookie', c);
  }
  return response;
}

export const config = {
  // Everything except sign-in, the auth routes, Next internals and static files.
  matcher: ['/((?!auth/|api/auth/|forbidden|_next/|favicon\\.ico|.*\\.(?:png|svg|ico|txt)$).*)'],
};
