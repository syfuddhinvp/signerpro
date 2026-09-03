/**
 * Sign out. Revokes the backend `UserSession` row (and with it the refresh
 * token) *before* dropping the cookie — clearing the cookie alone would leave
 * a live refresh token and a device the user can never remove from their
 * session list.
 */
import { NextResponse } from 'next/server';
import { AUTH_TIMEOUT_MS, clearSessionCookie } from '@/lib/auth/handlers';
import { backendUrl, getSession } from '@/lib/auth/session';

export async function POST() {
  const session = await getSession();

  if (session) {
    try {
      await fetch(`${backendUrl()}/api/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      });
    } catch {
      // The backend being unreachable must not strand the user signed in on
      // this device; the cookie still goes.
    }
  }

  return clearSessionCookie(NextResponse.json({ ok: true, next: '/login' }));
}
