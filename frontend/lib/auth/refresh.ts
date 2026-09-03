/**
 * Refresh-token exchange.
 *
 * The backend's access token is short-lived (`JWT_EXPIRES_MINUTES`, 15 by
 * default) while the session cookie lasts as long as the backend's
 * `UserSession` row (12h, or 30d with "remember this device"). Without this
 * module the user would be bounced to `/login` a quarter of an hour after
 * signing in.
 *
 * `POST /api/auth/refresh` *rotates*: the presented refresh token is revoked
 * and a brand-new session row is issued, so the resulting envelope must always
 * be written back to the cookie. Two concurrent refreshes therefore race — the
 * loser's token is already revoked and it falls back to `/login`. Callers keep
 * that window small by refreshing on a 30s skew rather than on the 401.
 *
 * Runtime-agnostic (fetch + Web Crypto only) so middleware can use it too.
 */

import {
  backendUrl,
  encodeSession,
  type SessionEnvelope,
  type SessionUser,
} from './cookie';

export const REFRESH_TIMEOUT_MS = 8000;

export type RefreshOutcome =
  | { ok: true; cookieValue: string; token: string; user: SessionUser; remember: boolean }
  /** The refresh token is gone/revoked/expired: the session is over. */
  | { ok: false; reason: 'expired' }
  /** Transport failure or a 5xx — the existing cookie should be left alone. */
  | { ok: false; reason: 'unavailable' }
  /** No refresh token in the envelope (cookie minted before refresh existed). */
  | { ok: false; reason: 'absent' }
  /** The backend is throttling refreshes; back off, but keep the session. */
  | { ok: false; reason: 'throttled'; retryAfterMs: number };

/**
 * When the backend returns 429 we must not simply retry on the next
 * navigation: middleware refreshes on every matched request, so a retry loop
 * spends the whole window and re-arms it, and the throttle never drains. This
 * damper short-circuits refreshes until the server's `Retry-After` elapses.
 *
 * Best-effort by design: it is per-runtime-instance, so several edge instances
 * each get one probe rather than one globally. That is enough to break the
 * loop without adding shared state to the hot path.
 */
let cooldownUntil = 0;

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 15 * 60_000;

function parseRetryAfter(header: string | null): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_COOLDOWN_MS;
  return Math.min(seconds * 1000, MAX_COOLDOWN_MS);
}

export async function refreshSession(envelope: SessionEnvelope): Promise<RefreshOutcome> {
  if (!envelope.r) return { ok: false, reason: 'absent' };
  const remember = envelope.rm === true;

  const now = Date.now();
  if (now < cooldownUntil) {
    return { ok: false, reason: 'throttled', retryAfterMs: cooldownUntil - now };
  }

  let response: Response;
  try {
    response = await fetch(`${backendUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: envelope.r, remember }),
      cache: 'no-store',
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    cooldownUntil = Date.now() + retryAfterMs;
    return { ok: false, reason: 'throttled', retryAfterMs };
  }
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return { ok: false, reason: 'expired' };
  }
  if (!response.ok) return { ok: false, reason: 'unavailable' };

  const payload = (await response.json().catch(() => null)) as
    | { access_token?: unknown; refresh_token?: unknown; user?: SessionUser }
    | null;

  const token = payload?.access_token;
  const user = payload?.user;
  if (typeof token !== 'string' || !user) return { ok: false, reason: 'unavailable' };

  const refreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token : envelope.r;
  return {
    ok: true,
    token,
    user,
    remember,
    cookieValue: encodeSession(token, user, { refreshToken, remember }),
  };
}
