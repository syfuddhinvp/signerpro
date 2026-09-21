/**
 * Isomorphic transport core for the SignFlow API.
 *
 * This module is deliberately free of `server-only` imports so that both the
 * server transport (`lib/api/client.ts`) and the browser transport
 * (`lib/api/browser.ts`) can share one request/response contract. Nothing here
 * touches cookies or `next/headers`.
 */

export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];

export type ApiRequestInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Serialised onto the query string; `null`/`undefined` entries are dropped. */
  query?: Record<string, QueryValue>;
  /** JSON request body. Use `formData` for multipart uploads. */
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
  /** Next.js fetch cache directives (server transport only). */
  cache?: RequestCache;
  next?: { revalidate?: number | false; tags?: string[] };
  signal?: AbortSignal;
  /** Milliseconds before the request is aborted. Pass `0` to disable. */
  timeoutMs?: number;
};

/**
 * Default request deadline. Without one a hung backend hangs a server render
 * until the platform's own (much longer) limit fires, so every call gets a
 * timeout unless the caller opts out with `timeoutMs: 0`.
 */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Longer deadline for the endpoints that stream or generate files. */
export const DOWNLOAD_TIMEOUT_MS = 60_000;

/** The caller's signal, the deadline, or both. */
export function requestSignal(init: ApiRequestInit, fallbackMs = DEFAULT_TIMEOUT_MS): AbortSignal | undefined {
  const ms = init.timeoutMs ?? fallbackMs;
  const deadline = ms > 0 ? AbortSignal.timeout(ms) : undefined;
  if (!deadline) return init.signal;
  if (!init.signal) return deadline;
  // `AbortSignal.any` is Node 20+ / modern browsers; degrade to the caller's.
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([init.signal, deadline]) : init.signal;
}

export type ValidationIssue = {
  /** FastAPI's `loc`, e.g. `['body', 'email']`. */
  loc: (string | number)[];
  msg: string;
  type?: string;
};

/**
 * Every failure mode the UI has to tell apart. `kind` is the discriminant.
 *
 * - `unauthorized` — the session cookie is missing/expired. Callers should
 *   redirect to `/login` (server: `redirectToLogin()`).
 * - `forbidden` — authenticated but not entitled (wrong role / plan).
 * - `not_found` — also what the backend returns for cross-tenant ids.
 * - `validation` — 422 with FastAPI's `detail[]` parsed into `issues`.
 * - `conflict` — 409 (e.g. demoting the last org admin).
 * - `client` — any other 4xx. Billing answers a decline with a structured
 *   `detail` object (`decline_code`, `invoice_status`, `next_attempt_at`, …),
 *   which is kept on `detail` so screens can report it without a re-read.
 * - `server` — 5xx.
 * - `network` — fetch threw: backend down, DNS, abort.
 */
export type ApiError =
  | { kind: 'unauthorized'; status: 401; message: string }
  | { kind: 'forbidden'; status: 403; message: string }
  | { kind: 'not_found'; status: 404; message: string }
  | { kind: 'validation'; status: 422; message: string; issues: ValidationIssue[] }
  | { kind: 'conflict'; status: 409; message: string }
  | { kind: 'client'; status: number; message: string; detail?: Record<string, unknown> }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'network'; status: 0; message: string };

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiError };

export function apiOk<T>(status: number, data: T): ApiResult<T> {
  return { ok: true, status, data };
}

export function apiFail<T>(error: ApiError): ApiResult<T> {
  return { ok: false, status: error.status, error };
}

/** Build a query string from a param record, dropping empty values. */
export function toQueryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) params.append(key, String(entry));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Pull a human message out of FastAPI's `{detail: ...}` envelope. */
export function detailMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string };
      if (first && typeof first.msg === 'string') return first.msg;
    }
    /* The billing/entitlement errors answer with a structured detail —
       `{ error: 'subscription_inactive', message: '…', plan, … }` — and used to
       fall through to the generic fallback, so a 402 on upload or send read as
       "The request could not be completed." instead of naming the reason. */
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const message = (detail as { message?: unknown; detail?: unknown }).message
        ?? (detail as { detail?: unknown }).detail;
      if (typeof message === 'string' && message) return message;
    }
  }
  return fallback;
}

/** FastAPI's `{detail: {...}}` object envelope, when the detail is structured. */
export function detailObject(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || !('detail' in payload)) return undefined;
  const detail = (payload as { detail: unknown }).detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  return detail as Record<string, unknown>;
}

function validationIssues(payload: unknown): ValidationIssue[] {
  if (!payload || typeof payload !== 'object' || !('detail' in payload)) return [];
  const detail = (payload as { detail: unknown }).detail;
  if (!Array.isArray(detail)) return [];
  return detail
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map(entry => ({
      loc: Array.isArray(entry.loc) ? (entry.loc as (string | number)[]) : [],
      msg: typeof entry.msg === 'string' ? entry.msg : 'Invalid value',
      type: typeof entry.type === 'string' ? entry.type : undefined,
    }));
}

/** Map an HTTP status + parsed payload onto the discriminated `ApiError`. */
export function errorForStatus(status: number, payload: unknown): ApiError {
  if (status === 401) return { kind: 'unauthorized', status: 401, message: detailMessage(payload, 'Your session has expired.') };
  if (status === 403) return { kind: 'forbidden', status: 403, message: detailMessage(payload, 'You do not have access to this.') };
  if (status === 404) return { kind: 'not_found', status: 404, message: detailMessage(payload, 'Not found.') };
  if (status === 409) return { kind: 'conflict', status: 409, message: detailMessage(payload, 'That conflicts with the current state.') };
  if (status === 422) {
    return {
      kind: 'validation',
      status: 422,
      message: detailMessage(payload, 'Please check the details you entered.'),
      issues: validationIssues(payload),
    };
  }
  if (status >= 500) return { kind: 'server', status, message: detailMessage(payload, 'The SignerPro API returned an error.') };
  const detail = detailObject(payload);
  return {
    kind: 'client',
    status,
    message: detailMessage(payload, 'The request could not be completed.'),
    ...(detail ? { detail } : {}),
  };
}

/**
 * The one place a `fetch` is actually performed. `absoluteUrl` is already
 * fully-qualified (server) or origin-relative (browser); `token`, when given,
 * is attached as a bearer header.
 */
export async function requestJson<T>(
  absoluteUrl: string,
  init: ApiRequestInit = {},
  token?: string | null,
): Promise<ApiResult<T>> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...(init.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (init.formData) {
    body = init.formData;
  } else if (init.body !== undefined && method !== 'GET') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetch(`${absoluteUrl}${toQueryString(init.query)}`, {
      method,
      headers,
      body,
      signal: requestSignal(init),
      cache: init.cache ?? 'no-store',
      ...(init.next ? { next: init.next } : {}),
    } as RequestInit);
  } catch (cause) {
    const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    return apiFail({
      kind: 'network',
      status: 0,
      message: timedOut
        ? 'The SignerPro API did not respond in time.'
        : cause instanceof Error ? cause.message : 'The SignerPro API is unreachable.',
    });
  }

  if (response.status === 204) return apiOk(204, undefined as T);

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) return apiFail(errorForStatus(response.status, payload));
  return apiOk(response.status, payload as T);
}

/** Value or fallback — for screens that must render even when a call fails. */
export function unwrapOr<T>(result: ApiResult<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export function isUnauthorized<T>(result: ApiResult<T>): boolean {
  return !result.ok && result.error.kind === 'unauthorized';
}

/** A message safe to put in a toast. */
export function errorMessage<T>(result: ApiResult<T>): string {
  return result.ok ? '' : result.error.message;
}
