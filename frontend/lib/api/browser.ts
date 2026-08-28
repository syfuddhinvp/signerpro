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

import { apiFail, apiOk, requestJson, type ApiRequestInit, type ApiResult } from './result';

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

/** A binary response fetched through the proxy: the bytes plus a filename. */
export type ApiDownload = { blob: Blob; filename: string };

/** `attachment; filename="documents.zip"` → `documents.zip`. */
function filenameFromDisposition(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(value);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')) || fallback; } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain ? plain[1].trim() || fallback : fallback;
}

/**
 * Download a binary endpoint (a PDF, a zip, a CSV) through the session proxy.
 *
 * The proxy streams the upstream bytes and `content-disposition` untouched, so
 * this is a plain `fetch` + `blob()` — no base64 server action needed. Never
 * throws; failures come back as the same `ApiResult` shape as `apiCall`.
 */
export async function apiDownload(
  path: string,
  init: ApiRequestInit & { filename?: string } = {},
): Promise<ApiResult<ApiDownload>> {
  const target = proxyPath(path);
  if (!target) {
    return apiFail({ kind: 'client', status: 400, message: `Refusing to call a non-/api path: ${path}` });
  }
  const fallbackName = init.filename ?? 'download';
  let response: Response;
  try {
    response = await fetch(target, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
  } catch {
    return apiFail({ kind: 'network', status: 0, message: 'Cannot reach the SignForge API.' });
  }
  if (!response.ok) {
    return apiFail({
      kind: response.status >= 500 ? 'server' : 'client',
      status: response.status,
      message: response.status === 404
        ? 'Nothing to download'
        : `Download failed (${response.status})`,
    });
  }
  const blob = await response.blob();
  return apiOk(response.status, {
    blob,
    filename: filenameFromDisposition(response.headers.get('content-disposition'), fallbackName),
  });
}

/** Hand a downloaded blob to the browser as a file save. */
export function saveBlob(download: ApiDownload): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
