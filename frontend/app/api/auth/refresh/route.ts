/**
 * Exchange the refresh token in the session cookie for a fresh access token.
 *
 * `middleware.ts` does this transparently on page navigations; this route is
 * the browser's own recovery path — `lib/api/browser.ts` calls it once when a
 * client-side mutation comes back 401, and only falls through to `/login` if
 * the session is genuinely over.
 */
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/cookie';
import { decodeSession } from '@/lib/auth/cookie';
import { clearSessionCookie } from '@/lib/auth/handlers';
import { refreshSession } from '@/lib/auth/refresh';
import { cookies } from 'next/headers';

export async function POST() {
  const store = await cookies();
  const envelope = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!envelope) {
    return clearSessionCookie(NextResponse.json({ ok: false, code: 'expired' }, { status: 401 }));
  }

  const result = await refreshSession(envelope);
  if (!result.ok) {
    if (result.reason === 'unavailable') {
      return NextResponse.json({ ok: false, code: 'unavailable' }, { status: 503 });
    }
    if (result.reason === 'throttled') {
      // Not an expired session: keep the cookie so the user is still signed in
      // once the window drains, and pass the backoff on to the caller.
      return NextResponse.json(
        { ok: false, code: 'throttled' },
        { status: 429, headers: { 'retry-after': String(Math.ceil(result.retryAfterMs / 1000)) } },
      );
    }
    return clearSessionCookie(NextResponse.json({ ok: false, code: 'expired' }, { status: 401 }));
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: result.cookieValue,
    ...sessionCookieOptions(result.remember),
  });
  return response;
}
