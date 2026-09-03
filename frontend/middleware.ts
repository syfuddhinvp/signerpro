import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, mayActAsPlatformAdmin, readEdgeSession, type EdgeSession } from '@/lib/auth/edge';
import { sessionCookieOptions } from '@/lib/auth/cookie';
import { refreshSession } from '@/lib/auth/refresh';

/**
 * Route protection and access-token rotation.
 *
 * Everything is private except the auth screens, the auth route handlers and
 * the links mailed to people who have no account: the signer link
 * (`/sign/<token>`), the password-reset link (`/reset-password?token=…`) and
 * the invitation link (`/invite/<token>`).
 *
 * Middleware is also the one place on a page navigation that can both read the
 * httpOnly cookie and write a new one, so it is where the short-lived access
 * token is exchanged for a fresh one (see `lib/auth/refresh.ts`).
 */
const PUBLIC_PREFIXES = ['/login', '/register', '/api/auth', '/sign', '/reset-password', '/invite'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function loginRedirect(request: NextRequest, pathname: string, search: string) {
  const url = new URL('/login', request.url);
  url.searchParams.set('next', `${pathname}${search}`);
  const response = NextResponse.redirect(url);
  if (request.cookies.has(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await readEdgeSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublic(pathname)) {
    // Signed-in users have no business on the sign-in screens.
    if (session && (pathname === '/login' || pathname === '/register')) {
      return NextResponse.redirect(new URL('/overview', request.url));
    }
    return NextResponse.next();
  }

  if (!session) return loginRedirect(request, pathname, search);

  // Rotate a spent access token before the page renders, so server components
  // downstream fetch with a live bearer token.
  let rotatedCookie: string | null = null;
  let current: EdgeSession = session;
  if (session.stale) {
    const refreshed = await refreshSession(session.envelope);
    if (refreshed.ok) {
      rotatedCookie = refreshed.cookieValue;
      const reread = await readEdgeSession(refreshed.cookieValue);
      if (reread) current = reread;
    } else if (refreshed.reason === 'expired' || refreshed.reason === 'absent') {
      return loginRedirect(request, pathname, search);
    }
    // 'unavailable' (backend down) and 'throttled' (rate limited): carry on
    // with the old cookie and let the API layer surface it, rather than
    // logging the user out over it. `refreshSession` holds off on its own
    // until Retry-After elapses, so navigating does not deepen a throttle.
  }

  if ((pathname === '/platform' || pathname.startsWith('/platform/')) && !mayActAsPlatformAdmin(current)) {
    return NextResponse.redirect(new URL('/overview', request.url));
  }

  const response = rotatedCookie
    ? NextResponse.next({ request: { headers: withCookie(request, rotatedCookie) } })
    : NextResponse.next();
  if (rotatedCookie) {
    response.cookies.set({
      name: SESSION_COOKIE,
      value: rotatedCookie,
      ...sessionCookieOptions(current.envelope.rm),
    });
  }
  return response;
}

/** Rewrite the outgoing `cookie` header so this render sees the rotated value. */
function withCookie(request: NextRequest, value: string): Headers {
  const headers = new Headers(request.headers);
  const jar = request.cookies
    .getAll()
    .filter(c => c.name !== SESSION_COOKIE)
    .map(c => `${c.name}=${c.value}`);
  jar.push(`${SESSION_COOKIE}=${value}`);
  headers.set('cookie', jar.join('; '));
  return headers;
}

export const config = {
  // Skip Next internals, the favicon and anything that looks like a static asset.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
