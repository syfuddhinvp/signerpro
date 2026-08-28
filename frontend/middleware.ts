import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, readEdgeSession } from '@/lib/auth/edge';

/**
 * Route protection. Everything is private except the auth screens, the auth
 * route handlers and the public signer links (`/sign/<token>`), which are
 * opened by recipients who have no account at all.
 */
const PUBLIC_PREFIXES = ['/login', '/register', '/api/auth', '/sign'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = readEdgeSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (isPublic(pathname)) {
    // Signed-in users have no business on the sign-in screens.
    if (session && (pathname === '/login' || pathname === '/register')) {
      return NextResponse.redirect(new URL('/overview', request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', `${pathname}${search}`);
    const response = NextResponse.redirect(url);
    // Drop an expired/undecodable cookie so it stops re-triggering this hop.
    if (request.cookies.has(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if ((pathname === '/platform' || pathname.startsWith('/platform/')) && !session.isPlatformAdmin) {
    return NextResponse.redirect(new URL('/overview', request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, the favicon and anything that looks like a static asset.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)'],
};
