/**
 * Shared plumbing for the auth route handlers: forward credentials to the
 * FastAPI backend, then mint the httpOnly `sf_session` cookie. The access token
 * is never returned to the browser.
 */

import 'server-only';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, backendUrl, encodeSession, type SessionUser } from './session';

export type AuthResult =
  | { ok: true; user: { id: string; name: string; email: string; role: string; organizationId: string; isPlatformAdmin: boolean }; next: string }
  | { ok: false; error: string; code: 'bad_request' | 'invalid_credentials' | 'conflict' | 'backend_unreachable' | 'backend_error' };

const COOKIE_MAX_AGE = 60 * 60 * 12;

function jsonError(code: Extract<AuthResult, { ok: false }>['code'], error: string, status: number) {
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
export async function forwardAuth(path: string, body: unknown, next: string) {
  const url = `${backendUrl()}${path}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return jsonError(
      'backend_unreachable',
      `Cannot reach the SignForge API at ${url}. Start the backend or set BACKEND_URL.`,
      503,
    );
  }

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    if (upstream.status === 401) return jsonError('invalid_credentials', detailOf(payload, 'Incorrect email or password.'), 401);
    if (upstream.status === 409) return jsonError('conflict', detailOf(payload, 'That account already exists.'), 409);
    if (upstream.status === 400 || upstream.status === 422) return jsonError('bad_request', detailOf(payload, 'Please check the details you entered.'), 400);
    return jsonError('backend_error', detailOf(payload, 'The SignForge API returned an unexpected error.'), 502);
  }

  const token = (payload as { access_token?: unknown } | null)?.access_token;
  const user = (payload as { user?: SessionUser } | null)?.user;
  if (typeof token !== 'string' || !user) {
    return jsonError('backend_error', 'The SignForge API returned an unrecognised login response.', 502);
  }

  // `is_platform_admin` is deliberately absent from the login response's user
  // schema (it lives on CurrentUserResponse only), so ask /me for it.
  const enriched: SessionUser = { ...user, is_platform_admin: await isPlatformAdmin(token) };

  const response = NextResponse.json({
    ok: true,
    user: {
      id: enriched.id,
      name: enriched.name,
      email: enriched.email,
      role: enriched.role,
      organizationId: enriched.organization_id,
      isPlatformAdmin: enriched.is_platform_admin === true,
    },
    next,
  } satisfies AuthResult);

  response.cookies.set({
    name: SESSION_COOKIE,
    value: encodeSession(token, enriched),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}

async function isPlatformAdmin(token: string): Promise<boolean> {
  try {
    const me = await fetch(`${backendUrl()}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!me.ok) return false;
    const body = await me.json();
    return body?.is_platform_admin === true;
  } catch {
    return false;
  }
}

/** Where to land after a successful login — only same-origin paths are honoured. */
export function safeNext(candidate: unknown, fallback = '/overview'): string {
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  if (candidate === '/login' || candidate.startsWith('/login/') || candidate === '/register') return fallback;
  return candidate;
}
