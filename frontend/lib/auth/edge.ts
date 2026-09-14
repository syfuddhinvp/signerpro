/**
 * Edge-safe session reading for `middleware.ts`. Kept separate from
 * `lib/auth/session.ts` because that module is server-only (next/headers) and
 * must not be pulled into the middleware bundle. The cookie format itself lives
 * in `lib/auth/cookie.ts`, shared by both.
 */

import {
  SESSION_COOKIE,
  accessTokenStale,
  decodeJwtPayload,
  decodeSession,
  isImpersonating,
  secondsUntilExpiry,
  type SessionEnvelope,
} from './cookie';
import { allowUnverifiedPrivilege, verifyAccessToken } from './verify';

export { SESSION_COOKIE };

export type EdgeSession = {
  userId: string;
  isPlatformAdmin: boolean;
  /** The signature was actually checked against a configured secret. */
  verified: boolean;
  /** The access token is spent (or nearly): middleware should refresh. */
  stale: boolean;
  /** The cookie is a platform admin acting as a tenant user. */
  impersonating: boolean;
  envelope: SessionEnvelope;
};

/**
 * Decode *and verify* the session cookie.
 *
 * Returns null for a forged or malformed cookie. A structurally valid cookie
 * that could not be verified (no secret configured) comes back with
 * `verified: false`; callers must not grant privilege on it.
 */
export async function readEdgeSession(cookieValue: string | undefined): Promise<EdgeSession | null> {
  const envelope = decodeSession(cookieValue);
  if (!envelope) return null;

  const outcome = await verifyAccessToken(envelope.t);
  if (outcome === 'invalid') return null;

  const claims = decodeJwtPayload(envelope.t);
  if (!claims) return null;

  const remaining = secondsUntilExpiry(envelope.t);
  const expired = remaining !== null && remaining <= 0;
  // An expired access token is still a live session while a refresh token
  // remains: middleware exchanges it rather than bouncing the user.
  if (expired && !envelope.r) return null;

  const userId = typeof claims.sub === 'string' ? claims.sub : envelope.u.id;
  if (!userId) return null;

  return {
    userId,
    isPlatformAdmin: envelope.u.is_platform_admin === true,
    verified: outcome === 'valid',
    stale: accessTokenStale(envelope.t),
    impersonating: isImpersonating(envelope),
    envelope,
  };
}

/** May this session be treated as a platform admin? Fails closed when unverified. */
export function mayActAsPlatformAdmin(session: EdgeSession): boolean {
  if (!session.isPlatformAdmin) return false;
  return session.verified || allowUnverifiedPrivilege();
}
