import { NextResponse } from 'next/server';
import { AUTH_TIMEOUT_MS } from '@/lib/auth/handlers';
import { backendUrl } from '@/lib/auth/cookie';

/**
 * Start a SAML sign-in for one workspace.
 *
 * This lives on the frontend origin rather than sending the browser straight
 * at the API because the whole SSO round trip is advertised to the IdP under
 * `APP_BASE_URL` — the ACS sibling of this route is the reply-to address in
 * the SP metadata, so the backend need not be reachable from the browser at
 * all. The backend answers with a 303 to the IdP, which is re-issued here.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const clean = slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(clean)) {
    return NextResponse.redirect(new URL('/login?sso=unknown', appOrigin(request)), 303);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/api/auth/sso/login/${encodeURIComponent(clean)}`, {
      // The redirect is the payload: following it here would fetch the IdP's
      // login page server-side and strip the browser of the session it needs.
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.redirect(new URL('/login?sso=unreachable', appOrigin(request)), 303);
  }

  const location = upstream.headers.get('location');
  if (!location) {
    // The backend reveals nothing beyond "no SSO here" for an unknown slug,
    // and neither does this: the message is the same either way.
    return NextResponse.redirect(new URL('/login?sso=unknown', appOrigin(request)), 303);
  }
  return NextResponse.redirect(location, 303);
}

function appOrigin(request: Request): string {
  return new URL(request.url).origin;
}
