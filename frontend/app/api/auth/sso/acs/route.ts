import { NextResponse } from 'next/server';
import { AUTH_TIMEOUT_MS, withSessionCookie } from '@/lib/auth/handlers';
import { backendUrl } from '@/lib/auth/cookie';

/**
 * SAML assertion consumer service.
 *
 * The IdP posts a form here — to the frontend origin, because that is the
 * `AssertionConsumerService` URL in the SP metadata the backend publishes. The
 * assertion is forwarded verbatim for signature checking; the backend
 * reconstructs the expected destination from `APP_BASE_URL` rather than from
 * any header, so proxying it does not weaken that check.
 *
 * The browser arriving here is mid-navigation, so the answer has to be a
 * redirect carrying the session cookie, not the JSON the backend returns.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const form = await request.formData().catch(() => null);
  const assertion = form?.get('SAMLResponse');
  if (typeof assertion !== 'string' || !assertion) {
    return NextResponse.redirect(new URL('/login?sso=failed', origin), 303);
  }

  const forwarded = new URLSearchParams({ SAMLResponse: assertion });
  const relayState = form?.get('RelayState');
  if (typeof relayState === 'string' && relayState) forwarded.set('RelayState', relayState);

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/api/auth/sso/acs`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: forwarded.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.redirect(new URL('/login?sso=unreachable', origin), 303);
  }

  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    // A rejected assertion is not the user's mistake to correct in detail, and
    // the backend's reason (unknown issuer, bad signature, domain not allowed)
    // is for the logs, not the login screen.
    return NextResponse.redirect(new URL('/login?sso=failed', origin), 303);
  }

  const redirect = NextResponse.redirect(new URL('/overview', origin), 303);
  // A SAML session is an IdP-managed one; it is not "remember this device".
  return withSessionCookie(redirect, payload, { remember: false });
}
