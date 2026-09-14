/**
 * The session cookie contract, shared by the server session layer
 * (`lib/auth/session.ts`), the route handlers (`lib/auth/handlers.ts`) and the
 * edge middleware (`lib/auth/edge.ts`).
 *
 * Deliberately free of `server-only`, `next/headers` and `Buffer` so the same
 * encoding/decoding rules apply in the Node runtime and on the edge.
 *
 * Cookie value: base64url of
 *   `{"t": <access token>, "u": <user record>, "r": <refresh token>, "rm": <remember>,
 *     "imp": <the platform admin to return to, while impersonating>}`
 * The access token is short-lived (the backend defaults to 15 minutes), so the
 * refresh token travels in the same httpOnly envelope and is exchanged at
 * `POST /api/auth/refresh` whenever the access token is spent. Neither token
 * ever reaches client JS.
 */

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

/**
 * The platform admin's own session, parked while they impersonate a tenant.
 *
 * Impersonation *replaces* the identity in the cookie, because that cookie is
 * the only thing the proxy and the server components read — so the way back
 * has to travel with it. Nothing here is new privilege: `t` is the same admin
 * token the browser already held, and it is verified again on the way back.
 */
export type ImpersonationStash = {
  t: string;
  u: SessionUser;
  r?: string;
  rm?: boolean;
};

export type SessionEnvelope = {
  /** Access token (JWT, HS256). While impersonating, the impersonation token. */
  t: string;
  u: SessionUser;
  /**
   * Opaque refresh token. Absent for sessions minted before refresh existed,
   * and deliberately absent while impersonating — see `impersonationCookie`.
   */
  r?: string;
  /** Whether the user asked to be remembered — drives the cookie lifetime. */
  rm?: boolean;
  /** Present only while impersonating. */
  imp?: ImpersonationStash;
};

/** Backend session lifetimes (`auth_service.SESSION_TTL_HOURS` / `_REMEMBER_TTL_DAYS`). */
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Cookie lifetime, matched to the *refresh* session the backend issued rather
 * than to the access token inside it. The access token expires in minutes and
 * is rotated transparently; the cookie must outlive it or every rotation would
 * be pointless.
 */
export function sessionMaxAge(remember: boolean | undefined): number {
  return remember ? REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
}

/**
 * Whether to mark the cookie `Secure`.
 *
 * Keyed on the *deployment*, never on `NODE_ENV`: a staging box built with
 * `next dev` is still served over TLS to real users and must not ship a
 * non-Secure session cookie.
 *
 * Order: explicit `SESSION_COOKIE_SECURE` → the scheme of `APP_BASE_URL` →
 * a named deploy environment → `NODE_ENV` as the last resort.
 */
export function cookieSecure(): boolean {
  const explicit = process.env.SESSION_COOKIE_SECURE;
  if (explicit) return explicit !== 'false' && explicit !== '0';

  const base = process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_APP_BASE_URL;
  if (base) return base.startsWith('https://');

  const deployEnv = process.env.APP_ENV ?? process.env.DEPLOY_ENV ?? process.env.VERCEL_ENV;
  if (deployEnv) return deployEnv !== 'development' && deployEnv !== 'local' && deployEnv !== 'test';

  return process.env.NODE_ENV === 'production';
}

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
};

export function sessionCookieOptions(remember?: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    maxAge: sessionMaxAge(remember),
  };
}

// --- base64url, runtime-agnostic -------------------------------------------

function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

export function b64urlEncode(raw: string): string {
  const binary = bytesToBinary(new TextEncoder().encode(raw));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(raw: string): string | null {
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function plausibleUser(value: unknown): value is SessionUser {
  return typeof value === 'object' && value !== null && typeof (value as SessionUser).id === 'string';
}

/** Build the cookie value for a successful login / refresh. */
export function encodeSession(
  token: string,
  user: SessionUser,
  extras: { refreshToken?: string | null; remember?: boolean } = {},
): string {
  const envelope: SessionEnvelope = { t: token, u: user };
  if (extras.refreshToken) envelope.r = extras.refreshToken;
  if (extras.remember) envelope.rm = true;
  return b64urlEncode(JSON.stringify(envelope));
}

export function decodeSession(value: string | undefined): SessionEnvelope | null {
  if (!value) return null;
  const json = b64urlDecode(value);
  if (!json) return null;
  let envelope: SessionEnvelope;
  try {
    envelope = JSON.parse(json) as SessionEnvelope;
  } catch {
    return null;
  }
  if (!envelope || typeof envelope.t !== 'string' || !envelope.u) return null;
  // A malformed stash is fatal rather than ignorable: dropping it would strand
  // the admin inside a tenant with no way back to their own identity.
  if (envelope.imp !== undefined) {
    const stash = envelope.imp;
    if (typeof stash?.t !== 'string' || !plausibleUser(stash.u)) return null;
  }
  return envelope;
}

// --- impersonation ---------------------------------------------------------

/**
 * The cookie value for "this admin is now acting as this tenant user".
 *
 * The impersonation token carries no refresh token, and this deliberately does
 * not copy the admin's into the live slot: the backend *rotates* on refresh, so
 * presenting it here would revoke the admin's own session and hand the rotated
 * credential to the tenant identity. The impersonation token simply expires at
 * its `exp`, and `expireImpersonation` puts the admin back.
 */
export function impersonationCookie(
  token: string,
  user: SessionUser,
  admin: SessionEnvelope,
): string {
  const stash: ImpersonationStash = { t: admin.t, u: admin.u };
  if (admin.r) stash.r = admin.r;
  if (admin.rm) stash.rm = true;

  const envelope: SessionEnvelope = { t: token, u: user, imp: stash };
  if (admin.rm) envelope.rm = true;
  return b64urlEncode(JSON.stringify(envelope));
}

export function isImpersonating(envelope: SessionEnvelope | null): boolean {
  return envelope?.imp !== undefined;
}

/** The parked admin session as an envelope in its own right. */
export function adminEnvelope(envelope: SessionEnvelope | null): SessionEnvelope | null {
  const stash = envelope?.imp;
  if (!stash) return null;
  const restored: SessionEnvelope = { t: stash.t, u: stash.u };
  if (stash.r) restored.r = stash.r;
  if (stash.rm) restored.rm = true;
  return restored;
}

/** Serialise an envelope back to a cookie value, stash and all. */
export function encodeEnvelope(envelope: SessionEnvelope): string {
  return b64urlEncode(JSON.stringify(envelope));
}

/**
 * The admin cookie to write when an impersonation token is spent, or null when
 * there is nothing to do.
 *
 * An impersonation token cannot be refreshed, so without this an expiring
 * session would read as a dead cookie and bounce a platform admin to `/login`
 * — losing a perfectly good admin session because a support visit timed out.
 */
export function expireImpersonation(cookieValue: string | undefined): string | null {
  const envelope = decodeSession(cookieValue);
  if (!envelope?.imp) return null;
  if (!accessTokenStale(envelope.t)) return null;
  const admin = adminEnvelope(envelope);
  return admin ? encodeEnvelope(admin) : null;
}

/** Decode a JWT's payload. Says nothing about the signature — see `verify.ts`. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const json = b64urlDecode(parts[1]);
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Seconds until the access token expires; `null` when it carries no `exp`. */
export function secondsUntilExpiry(token: string): number | null {
  const claims = decodeJwtPayload(token);
  const exp = claims && typeof claims.exp === 'number' ? claims.exp : null;
  if (exp === null) return null;
  return exp - Math.floor(Date.now() / 1000);
}

/** True when the token is spent, or close enough that a call would race it. */
export function accessTokenStale(token: string, skewSeconds = 30): boolean {
  const remaining = secondsUntilExpiry(token);
  return remaining !== null && remaining <= skewSeconds;
}

export function backendUrl(): string {
  return process.env.BACKEND_URL ?? 'http://localhost:8000';
}
