/**
 * Server-side transport for the SignFlow API.
 *
 * Use from server components, server actions and route handlers only — it
 * reads the httpOnly `sf_session` cookie (via `lib/auth/session.ts`) and
 * attaches the access token as a bearer header, exactly the way
 * `lib/auth/handlers.ts` forwards credentials at login.
 *
 * Client components must not import this module: use
 * `lib/api/browser.ts#apiCall`, which goes through `/api/proxy/[...path]` so
 * the token never reaches client JS.
 */

import 'server-only';
import { redirect } from 'next/navigation';
import { backendUrl, getSession } from '@/lib/auth/session';
import {
  apiFail,
  requestJson,
  type ApiRequestInit,
  type ApiResult,
} from './result';

export * from './result';

/** `/api/contacts` → `http://backend/api/contacts`. Only `/api/*` is allowed. */
function resolve(path: string): string | null {
  if (!path.startsWith('/api/') && path !== '/api') return null;
  if (path.includes('..')) return null;
  return `${backendUrl()}${path}`;
}

/**
 * Call the backend with the caller's session token.
 *
 * Never throws: transport and HTTP failures come back as `ApiResult.error`
 * with a discriminated `kind` (see `lib/api/result.ts`).
 *
 * ```ts
 * const res = await apiFetch<ContactListResponse>('/api/contacts', { query: { limit: 200 } });
 * if (!res.ok && res.error.kind === 'unauthorized') redirectToLogin('/contacts');
 * ```
 */
export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
  const url = resolve(path);
  if (!url) {
    return apiFail({ kind: 'client', status: 400, message: `Refusing to call a non-/api path: ${path}` });
  }
  const session = await getSession();
  if (!session) {
    return apiFail({ kind: 'unauthorized', status: 401, message: 'No active session.' });
  }
  return requestJson<T>(url, init, session.token);
}

/**
 * Same as `apiFetch` but for endpoints the backend exposes without a token
 * (e.g. `GET /api/billing/plans`, `GET /api/sign/{token}`). Sends the session
 * token when one happens to exist.
 */
export async function apiFetchPublic<T>(path: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
  const url = resolve(path);
  if (!url) {
    return apiFail({ kind: 'client', status: 400, message: `Refusing to call a non-/api path: ${path}` });
  }
  const session = await getSession();
  return requestJson<T>(url, init, session?.token ?? null);
}

/** Send an expired/absent session back to the sign-in screen. */
export function redirectToLogin(next?: string): never {
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
}

/**
 * `apiFetch` + the 401 redirect every authenticated screen wants. Other
 * failures are returned so the screen can degrade instead of blowing up.
 */
export async function apiFetchOrLogin<T>(
  path: string,
  init: ApiRequestInit = {},
  next?: string,
): Promise<ApiResult<T>> {
  const result = await apiFetch<T>(path, init);
  if (!result.ok && result.error.kind === 'unauthorized') redirectToLogin(next);
  return result;
}

/**
 * A `Caller` for `lib/api/resources.ts` bound to the server transport.
 *
 * ```ts
 * const api = serverCaller('/contacts');   // 401 → /login?next=/contacts
 * const res = await contacts.list(api, { limit: 200 });
 * ```
 */
export function serverCaller(next?: string) {
  return <R,>(path: string, init: ApiRequestInit = {}) => apiFetchOrLogin<R>(path, init, next);
}

/** Same, but a 401 comes back as an `ApiResult` error instead of redirecting. */
export function serverCallerSoft() {
  return <R,>(path: string, init: ApiRequestInit = {}) => apiFetch<R>(path, init);
}
