import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, mayActAsPlatformAdmin, readEdgeSession, type EdgeSession } from '@/lib/auth/edge';
import { backendUrl, expireImpersonation, sessionCookieOptions } from '@/lib/auth/cookie';
import { refreshSession } from '@/lib/auth/refresh';
import { pathAllowed } from '@/lib/auth/access';
import { MARKETING_PUBLIC_PREFIXES } from '@/lib/marketing/routes';

/**
 * Route protection and access-token rotation.
 *
 * Everything is private except the marketing site (`/` plus the prefixes in
 * `lib/marketing/routes.ts`), the
 * auth screens, the auth route handlers and the links mailed to people who
 * have no account: the signer link
 * (`/sign/<token>`), the password-reset link (`/reset-password?token=…`) and
 * the invitation link (`/invite/<token>`) and the branding logo embedded in
 * invitation emails (`/brand/<id>/logo`, an image and nothing else).
 *
 * Middleware is also the one place on a page navigation that can both read the
 * httpOnly cookie and write a new one, so it is where the short-lived access
 * token is exchanged for a fresh one (see `lib/auth/refresh.ts`) and where a
 * spent impersonation session hands the cookie back to the admin who started
 * it (see `expireImpersonation`).
 */
const PUBLIC_PREFIXES = [
  ...MARKETING_PUBLIC_PREFIXES,
  '/login', '/register', '/api/auth', '/sign', '/reset-password', '/invite', '/verify', '/embed', '/brand',
];

function isPublic(pathname: string): boolean {
  // `/` is matched exactly and never as a prefix — as a prefix it would make
  // every route in the app public. The page itself sends a signed-in visitor
  // on to `/overview`.
  if (pathname === '/') return true;
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

  /* An impersonation token has no refresh token, so a spent one must fall back
     to the parked admin session rather than read as a dead cookie. Done before
     anything else looks at the cookie, so the rest of this function — the
     /platform guard included — sees the identity that is actually in force. */
  const rawCookie = request.cookies.get(SESSION_COOKIE)?.value;
  const restoredCookie = expireImpersonation(rawCookie);
  const session = await readEdgeSession(restoredCookie ?? rawCookie);

  if (isPublic(pathname)) {
    // Signed-in users have no business on the sign-in screens.
    if (session && (pathname === '/login' || pathname === '/register')) {
      return NextResponse.redirect(new URL('/overview', request.url));
    }
    if (pathname === '/embed' || pathname.startsWith('/embed/')) {
      return await embedResponse(request);
    }
    return NextResponse.next();
  }

  if (!session) return loginRedirect(request, pathname, search);

  // Rotate a spent access token before the page renders, so server components
  // downstream fetch with a live bearer token.
  let rotatedCookie: string | null = restoredCookie;
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

  // A sender's tree is smaller than an admin's (see `lib/auth/access.ts`).
  // The sidebar hides what they may not use; this is what makes a typed-in
  // `/reports` or `/account/billing` bounce instead of render.
  if (!pathAllowed(pathname, current.envelope.u.role)) {
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


/**
 * The embed surface, with framing decided per session.
 *
 * `next.config.ts` can only express a build-time, deployment-wide allowlist —
 * it cannot know the tenant, which is exactly what `frame-ancestors` has to
 * encode here. So the session's own `organizations.allowed_origins` is fetched
 * and turned into the directive, and the static header for `/:path*`
 * (`frame-ancestors 'none'` + `X-Frame-Options: DENY`) is overridden for this
 * path only.
 *
 * This is the only enforcement point that works. `allowed_origins` names *host
 * applications*, and a host application never sends us a request of its own —
 * so no `Origin` check on the API can stand in for it, and the browser's
 * refusal to paint the frame is the real control.
 *
 * FAIL CLOSED: an absent, unknown or expired token, or a backend that does not
 * answer, yields `'none'`. The page still renders — unframed — as its designed
 * error state.
 */
async function embedResponse(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('session');
  const ancestors = token ? await frameAncestors(token) : [];
  const source = ancestors.length ? ancestors.join(' ') : "'none'";

  const response = NextResponse.next();
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-src 'self'",
      `frame-ancestors ${source}`,
    ].join('; '),
  );
  // X-Frame-Options has no allowlist form: emitting it alongside an allowing
  // frame-ancestors would make older browsers block a permitted embed. It is
  // only meaningful when framing is denied outright.
  if (ancestors.length) response.headers.delete('X-Frame-Options');
  else response.headers.set('X-Frame-Options', 'DENY');
  return response;
}

async function frameAncestors(token: string): Promise<string[]> {
  try {
    const res = await fetch(
      `${backendUrl()}/api/embed/frame-ancestors?token=${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { frame_ancestors?: string[] };
    // Only absolute http(s) origins reach the header — never a bare host, and
    // never a wildcard the tenant could have typed into their settings.
    return (body.frame_ancestors ?? []).filter(o => /^https?:\/\/[^\s'";]+$/.test(o));
  } catch {
    return [];
  }
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
