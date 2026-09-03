/**
 * The session cookie contract, shared by the server session layer
 * (`lib/auth/session.ts`), the route handlers (`lib/auth/handlers.ts`) and the
 * edge middleware (`lib/auth/edge.ts`).
 *
 * Deliberately free of `server-only`, `next/headers` and `Buffer` so the same
 * encoding/decoding rules apply in the Node runtime and on the edge.
 *
 * Cookie value: base64url of
 *   `{"t": <access token>, "u": <user record>, "r": <refresh token>, "rm": <remember>}`
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

export type SessionEnvelope = {
  /** Access token (JWT, HS256). */
  t: string;
  u: SessionUser;
  /** Opaque refresh token. Absent for sessions minted before refresh existed. */
  r?: string;
  /** Whether the user asked to be remembered — drives the cookie lifetime. */
  rm?: boolean;
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
  return envelope;
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
