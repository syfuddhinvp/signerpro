/**
 * Edge-safe cookie reading for `middleware.ts`. Kept separate from
 * `lib/auth/session.ts` because that module is server-only (next/headers,
 * Buffer) and must not be pulled into the middleware bundle.
 */

export const SESSION_COOKIE = 'sf_session';

function b64url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

export type EdgeSession = { userId: string; isPlatformAdmin: boolean };

/** Decode (never verify — the backend verifies) the session cookie. */
export function readEdgeSession(cookieValue: string | undefined): EdgeSession | null {
  if (!cookieValue) return null;
  const decoded = b64url(cookieValue);
  if (!decoded) return null;

  let env: { t?: string; u?: { id?: string; is_platform_admin?: boolean } };
  try {
    env = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!env?.t || !env.u) return null;

  const payload = b64url(env.t.split('.')[1] ?? '');
  if (!payload) return null;
  let claims: { sub?: string; exp?: number };
  try {
    claims = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null;

  const userId = claims.sub ?? env.u.id;
  if (!userId) return null;
  return { userId, isPlatformAdmin: env.u.is_platform_admin === true };
}
