/**
 * HS256 verification of the access token carried in the session cookie.
 *
 * Why this exists: the cookie is an unauthenticated blob from the browser's
 * point of view. Reading `is_platform_admin` out of it and using that to gate
 * `/platform` (middleware) or `requirePlatformSession` (server) is only a guard
 * if the JWT it is stapled to is actually verified — otherwise a hand-rolled
 * envelope loads the platform-admin shell.
 *
 * The backend signs with HS256 (`backend/app/core/security.py: JWT_ALGORITHM`),
 * so verification needs the same shared secret. Provide it to the Next server
 * as `SESSION_JWT_SECRET` (preferred) or `JWT_SECRET`.
 *
 * Runtime-agnostic: Web Crypto is available in both the Node and edge runtimes.
 */

import { b64urlDecode } from './cookie';

/**
 * - `valid`     — signature and expiry check out.
 * - `invalid`   — a secret is configured and the token failed against it.
 * - `unverified`— no secret is configured, so nothing could be checked. Callers
 *                 must treat this as "structurally plausible, not trusted" and
 *                 refuse to make privilege decisions on it.
 */
export type VerifyOutcome = 'valid' | 'invalid' | 'unverified';

function secret(): string | null {
  const value = process.env.SESSION_JWT_SECRET ?? process.env.JWT_SECRET;
  return value && value.length > 0 ? value : null;
}

/** True when this deployment is able to verify session cookies at all. */
export function verificationConfigured(): boolean {
  return secret() !== null;
}

/**
 * Escape hatch for local development, where the frontend often does not hold
 * the backend's signing secret. Anywhere else, an unverifiable cookie must not
 * be allowed to claim platform-admin.
 */
export function allowUnverifiedPrivilege(): boolean {
  return process.env.ALLOW_UNVERIFIED_PLATFORM_ACCESS === 'true';
}

let cachedKey: { raw: string; key: CryptoKey } | null = null;

async function hmacKey(raw: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  cachedKey = { raw, key };
  return key;
}

function b64urlToBytes(value: string): Uint8Array | null {
  const binary = (() => {
    try {
      const padded = value.replace(/-/g, '+').replace(/_/g, '/');
      return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    } catch {
      return null;
    }
  })();
  if (binary === null) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Verify signature, algorithm and `exp` on a compact HS256 JWT. */
export async function verifyAccessToken(token: string): Promise<VerifyOutcome> {
  const configured = secret();
  if (!configured) return 'unverified';

  const parts = token.split('.');
  if (parts.length !== 3) return 'invalid';

  const headerJson = b64urlDecode(parts[0]);
  if (!headerJson) return 'invalid';
  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(headerJson) as { alg?: unknown };
  } catch {
    return 'invalid';
  }
  // Pin the algorithm: never let the token choose `none` or an RS/HS confusion.
  if (header.alg !== 'HS256') return 'invalid';

  const signature = b64urlToBytes(parts[2]);
  if (!signature) return 'invalid';

  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(configured),
      signature as unknown as ArrayBufferView,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return 'invalid';
  }
  return ok ? 'valid' : 'invalid';
}
