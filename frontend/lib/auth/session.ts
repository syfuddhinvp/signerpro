/**
 * Server-only session layer.
 *
 * The backend (FastAPI) is the only party that verifies the JWT — it does so on
 * every API call. Here we only *read* the cookie so server components can
 * render the right chrome and guard the right subtrees.
 *
 * Cookie: `sf_session`, httpOnly, sameSite lax, secure in production, path '/'.
 * Value: base64url of `{"t": <access_token>, "u": <user record from the backend>}`.
 * The backend's JWT payload carries only `{sub, exp}` (see
 * backend/app/core/security.py), so role / organization_id / is_platform_admin
 * cannot be read out of the token — they are captured from the login/register
 * response body and travel in the same httpOnly envelope. The token itself
 * never reaches client JS.
 */

import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const SESSION_COOKIE = 'sf_session';

export type SessionUser = {
  id: string;
  organization_id: string;
  organization_name?: string;
  name: string;
  email: string;
  role: string;
  is_platform_admin?: boolean;
};

export type Session = {
  token: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
  isPlatformAdmin: boolean;
};

type Envelope = { t: string; u: SessionUser };

function b64urlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function b64urlDecode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

/** Build the cookie value for a successful login/register. Used by route handlers. */
export function encodeSession(token: string, user: SessionUser): string {
  return b64urlEncode(JSON.stringify({ t: token, u: user } satisfies Envelope));
}

/** Decode a JWT's payload without verifying it (the backend verifies). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parse(value: string): Session | null {
  let env: Envelope;
  try {
    env = JSON.parse(b64urlDecode(value)) as Envelope;
  } catch {
    return null;
  }
  if (!env || typeof env.t !== 'string' || !env.u) return null;

  const claims = decodeJwtPayload(env.t);
  if (!claims) return null;
  const exp = typeof claims.exp === 'number' ? claims.exp : null;
  if (exp !== null && exp * 1000 <= Date.now()) return null;

  const userId = typeof claims.sub === 'string' ? claims.sub : env.u.id;
  if (!userId) return null;

  return {
    token: env.t,
    userId,
    name: env.u.name ?? '',
    email: env.u.email ?? '',
    role: env.u.role ?? 'sender',
    organizationId: env.u.organization_id ?? '',
    organizationName: env.u.organization_name ?? '',
    isPlatformAdmin: env.u.is_platform_admin === true,
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

/** Platform-role guard: tenants are bounced back to their own workspace. */
export async function requirePlatformSession(next?: string): Promise<Session> {
  const session = await requireSession(next);
  if (!session.isPlatformAdmin) redirect('/overview');
  return session;
}

export function backendUrl(): string {
  return process.env.BACKEND_URL ?? 'http://localhost:8000';
}
