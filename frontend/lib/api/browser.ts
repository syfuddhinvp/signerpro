/**
 * Browser-side transport for the SignFlow API.
 *
 * Client components never see the access token: `apiCall` rewrites
 * `/api/<rest>` to `/api/proxy/<rest>`, and the Next route handler at
 * `app/api/proxy/[...path]/route.ts` re-attaches the bearer token from the
 * httpOnly `sf_session` cookie before forwarding to FastAPI. Same forwarding
 * shape as `lib/auth/handlers.ts`, just generalised to every endpoint.
 */

'use client';

import { apiFail, requestJson, type ApiRequestInit, type ApiResult } from './result';

export * from './result';

export const PROXY_PREFIX = '/api/proxy';

/** `/api/contacts` → `/api/proxy/contacts`. Anything else is refused. */
export function proxyPath(path: string): string | null {
  if (!path.startsWith('/api/')) return null;
  if (path.includes('..')) return null;
  return `${PROXY_PREFIX}/${path.slice('/api/'.length)}`;
}

/**
 * Call the backend from the browser through the session proxy. Never throws;
 * the result is the same discriminated `ApiResult<T>` the server transport
 * returns, so a mutation handler can branch on `error.kind`.
 */
export async function apiCall<T>(path: string, init: ApiRequestInit = {}): Promise<ApiResult<T>> {
  const target = proxyPath(path);
  if (!target) {
    return apiFail({ kind: 'client', status: 400, message: `Refusing to call a non-/api path: ${path}` });
  }
  return requestJson<T>(target, init, null);
}
