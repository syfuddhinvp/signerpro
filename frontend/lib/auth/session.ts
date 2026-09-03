/**
 * Server-only session layer.
 *
 * The backend verifies the JWT on every API call; here we verify it a second
 * time (HS256, see `lib/auth/verify.ts`) before making any *privilege* decision
 * on the identity fields the envelope carries — `is_platform_admin` in
 * particular, which is read from the cookie body rather than the token claims.
 *
 * Cookie: `sf_session`, httpOnly, sameSite lax, Secure keyed on the deployment
 * (see `lib/auth/cookie.ts`), path '/'.
 * Value: base64url of `{t: access token, u: user, r: refresh token, rm: remember}`.
 * The tokens never reach client JS.
 *
 * Rotation happens in `middleware.ts` and the auth route handlers, which can
 * write cookies. This module deliberately never refreshes: a server component
 * that exchanged a refresh token would burn it and have nowhere to store the
 * rotated one.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  backendUrl,
  decodeJwtPayload,
  decodeSession,
  encodeSession,
  secondsUntilExpiry,
  sessionCookieOptions,
  type SessionUser,
} from './cookie';
import { allowUnverifiedPrivilege, verifyAccessToken } from './verify';

export { SESSION_COOKIE, backendUrl, encodeSession, decodeJwtPayload, sessionCookieOptions };
export type { SessionUser };

export type Session = {
  token: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
  isPlatformAdmin: boolean;
  /** False when no signing secret is configured, so the cookie is untrusted. */
  verified: boolean;
};

async function parse(value: string): Promise<Session | null> {
  const envelope = decodeSession(value);
  if (!envelope) return null;

  const outcome = await verifyAccessToken(envelope.t);
  if (outcome === 'invalid') return null;

  const claims = decodeJwtPayload(envelope.t);
  if (!claims) return null;
  const remaining = secondsUntilExpiry(envelope.t);
  if (remaining !== null && remaining <= 0) return null;

  const userId = typeof claims.sub === 'string' ? claims.sub : envelope.u.id;
  if (!userId) return null;

  return {
    token: envelope.t,
    userId,
    name: envelope.u.name ?? '',
    email: envelope.u.email ?? '',
    role: envelope.u.role ?? 'sender',
    organizationId: envelope.u.organization_id ?? '',
    organizationName: envelope.u.organization_name ?? '',
    isPlatformAdmin: envelope.u.is_platform_admin === true,
    verified: outcome === 'valid',
  };
}

/** Current session, or null when there is no usable cookie. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return parse(raw);
}

/** Session or bust — unauthenticated callers are sent to /login. */
export async function requireSession(next?: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  return session;
}

/**
 * Platform-role guard. Fails closed: a session whose signature could not be
 * checked (no secret configured) never gets platform access unless the
 * deployment opts in with `ALLOW_UNVERIFIED_PLATFORM_ACCESS=true`.
 */
export async function requirePlatformSession(next?: string): Promise<Session> {
  const session = await requireSession(next);
  if (!session.isPlatformAdmin) redirect('/overview');
  if (!session.verified && !allowUnverifiedPrivilege()) redirect('/overview');
  return session;
}
