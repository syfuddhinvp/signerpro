/**
 * Shared plumbing for the auth route handlers: forward credentials to the
 * FastAPI backend, then mint the httpOnly `sf_session` cookie. The access token
 * is never returned to the browser.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  backendUrl,
  encodeSession,
  sessionCookieOptions,
  type SessionUser,
} from './cookie';

export type AuthResult =
  | {
      ok: true;
      user: {
        id: string; name: string; email: string; role: string;
        organizationId: string; organizationName: string; isPlatformAdmin: boolean;
      };
      next: string;
    }
  | { ok: true; mfaRequired: true; mfaToken: string; delivery: string; maskedTarget: string }
  | { ok: false; error: string; code: AuthErrorCode };

/** Every failure the auth route handlers can report to the browser. */
export type AuthErrorCode =
  | 'bad_request'
  | 'invalid_credentials'
  | 'forbidden'
  | 'not_found'
  | 'gone'
  | 'conflict'
  | 'rate_limited'
  | 'backend_unreachable'
  | 'backend_error';

/** A hung backend must not hang the login request. */
export const AUTH_TIMEOUT_MS = 10_000;

export function jsonError(code: AuthErrorCode, error: string, status: number) {
  return NextResponse.json({ ok: false, code, error } satisfies AuthResult, { status });
}

/** Read a JSON body, tolerating an empty or malformed one. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function detailOf(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string };
      if (first && typeof first.msg === 'string') return first.msg;
    }
  }
  return fallback;
}

/**
 * POST `path` on the backend with `body`; on success set the session cookie.
 * An unreachable backend yields a clean 503 payload rather than a stack trace.
 */
export async function forwardAuth(
  path: string,
  body: unknown,
  next: string,
  options: { remember?: boolean } = {},
) {
  const url = `${backendUrl()}${path}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return jsonError(
      'backend_unreachable',
      `Cannot reach the SignerPro API at ${url}. Start the backend or set BACKEND_URL.`,
      503,
    );
  }

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    if (upstream.status === 401) return jsonError('invalid_credentials', detailOf(payload, 'Incorrect email or password.'), 401);
    if (upstream.status === 403) return jsonError('forbidden', detailOf(payload, 'This account cannot sign in.'), 403);
    if (upstream.status === 404) return jsonError('not_found', detailOf(payload, 'That link is not valid.'), 404);
    if (upstream.status === 409) return jsonError('conflict', detailOf(payload, 'That account already exists.'), 409);
    if (upstream.status === 410) return jsonError('gone', detailOf(payload, 'That link has expired or has already been used.'), 410);
    if (upstream.status === 429) return jsonError('rate_limited', detailOf(payload, 'Too many attempts. Please wait a moment and try again.'), 429);
    if (upstream.status === 400 || upstream.status === 422) return jsonError('bad_request', detailOf(payload, 'Please check the details you entered.'), 400);
    return jsonError('backend_error', detailOf(payload, 'The SignerPro API returned an unexpected error.'), 502);
  }

  // An account with confirmed MFA gets a challenge instead of a token: no
  // session is minted until the code is exchanged at /api/auth/mfa/verify.
  const challenge = payload as {
    mfa_required?: unknown; mfa_token?: unknown; delivery?: unknown; masked_target?: unknown;
  } | null;
  if (challenge?.mfa_required === true) {
    if (typeof challenge.mfa_token !== 'string') {
      return jsonError('backend_error', 'The SignerPro API returned an incomplete MFA challenge.', 502);
    }
    return NextResponse.json({
      ok: true,
      mfaRequired: true,
      mfaToken: challenge.mfa_token,
      delivery: typeof challenge.delivery === 'string' ? challenge.delivery : 'totp',
      maskedTarget: typeof challenge.masked_target === 'string' ? challenge.masked_target : '',
    } satisfies AuthResult);
  }

  return sessionResponse(payload, next, options);
}

/**
 * Turn a backend token payload into a JSON response carrying the session
 * cookie. Split out of `forwardAuth` because the SAML assertion consumer needs
 * the same cookie on a redirect rather than on a JSON body — see
 * `withSessionCookie`.
 */
function sessionResponse(payload: unknown, next: string, options: { remember?: boolean }) {
  const enriched = (payload as { user?: SessionUser } | null)?.user;
  if (!enriched) {
    return jsonError('backend_error', 'The SignerPro API returned an unrecognised login response.', 502);
  }

  const response = NextResponse.json({
    ok: true,
    user: {
      id: enriched.id,
      name: enriched.name,
      email: enriched.email,
      role: enriched.role,
      organizationId: enriched.organization_id,
      organizationName: (enriched as { organization_name?: string }).organization_name ?? '',
      isPlatformAdmin: enriched.is_platform_admin === true,
    },
    next,
  } satisfies AuthResult);

  return withSessionCookie(response, payload, options);
}

/**
 * Attach `sf_session` to any response, given a backend token payload. A payload
 * that is not a token response yields a JSON error instead of the response
 * passed in, so no caller can redirect someone to the app without a session.
 */
export function withSessionCookie<T extends NextResponse>(
  response: T,
  payload: unknown,
  options: { remember?: boolean } = {},
): T | NextResponse {
  const token = (payload as { access_token?: unknown } | null)?.access_token;
  const enriched = (payload as { user?: SessionUser } | null)?.user;
  if (typeof token !== 'string' || !enriched) {
    return jsonError('backend_error', 'The SignerPro API returned an unrecognised login response.', 502);
  }

  const refreshToken = (payload as { refresh_token?: unknown } | null)?.refresh_token;

  // The cookie lives as long as the backend's session row (12h, or 30d when
  // remembered) — not as long as the access token inside it, which expires in
  // minutes and is rotated by `middleware.ts` via the refresh token below.
  response.cookies.set({
    name: SESSION_COOKIE,
    value: encodeSession(token, enriched, {
      refreshToken: typeof refreshToken === 'string' ? refreshToken : null,
      remember: options.remember === true,
    }),
    ...sessionCookieOptions(options.remember),
  });

  return response;
}

/**
 * POST a backend endpoint and hand the browser its JSON verbatim. Used for the
 * halves of a ceremony that mint nothing — the WebAuthn challenge, which is
 * opaque to us and must reach `navigator.credentials.get()` unaltered.
 */
export async function forwardJson(path: string, body: unknown) {
  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return jsonError('backend_unreachable', 'Cannot reach the SignerPro API. Please try again in a moment.', 503);
  }

  const payload = await upstream.json().catch(() => null);
  if (upstream.ok) return NextResponse.json({ ok: true, options: payload });
  if (upstream.status === 429) {
    return jsonError('rate_limited', detailOf(payload, 'Too many attempts. Please wait a moment and try again.'), 429);
  }
  if (upstream.status === 400 || upstream.status === 422) {
    return jsonError('bad_request', detailOf(payload, 'Please check the details you entered.'), 400);
  }
  return jsonError('backend_error', detailOf(payload, 'The SignerPro API returned an unexpected error.'), 502);
}

/** Where to land after a successful login — only same-origin paths are honoured. */
export function safeNext(candidate: unknown, fallback = '/overview'): string {
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  if (candidate === '/login' || candidate.startsWith('/login/') || candidate === '/register') return fallback;
  if (candidate.startsWith('/reset-password') || candidate.startsWith('/invite')) return fallback;
  return candidate;
}

/** Clear the session cookie on a response (logout, or a dead refresh token). */
export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    ...sessionCookieOptions(false),
    maxAge: 0,
  });
  return response;
}

/** POST an unauthenticated backend endpoint that mints nothing (forgot password). */
export async function forwardPlain(path: string, body: unknown) {
  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    return jsonError('backend_unreachable', 'Cannot reach the SignerPro API. Please try again in a moment.', 503);
  }

  if (upstream.ok) return NextResponse.json({ ok: true });

  const payload = await upstream.json().catch(() => null);
  if (upstream.status === 429) {
    return jsonError('rate_limited', detailOf(payload, 'Too many requests. Please wait a moment and try again.'), 429);
  }
  if (upstream.status === 400 || upstream.status === 422) {
    return jsonError('bad_request', detailOf(payload, 'Please check the details you entered.'), 400);
  }
  return jsonError('backend_error', detailOf(payload, 'The SignerPro API returned an unexpected error.'), 502);
}
