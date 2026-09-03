/**
 * `lib/api/browser.ts` — the browser transport's 401 recovery.
 *
 * Protects three things the audit called out:
 *  - a 401 is not a dead end: the refresh cookie is exchanged and the call retried;
 *  - a failed refresh sends the user to `/login?next=<where they were>` rather
 *    than leaving a toast and a broken screen;
 *  - the refresh is single-flight. The backend rotates and revokes the refresh
 *    token on first use, so a screen that fires six calls on mount must present
 *    it exactly once — otherwise five of the six revoke a live session.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { proxyPath } from './browser';

const assign = vi.fn();

/**
 * A fresh module instance per test: `refreshInFlight` is module-level state
 * (deliberately — that is what makes the refresh single-flight), so tests must
 * not share it or they would be asserting against each other's leftovers.
 */
async function freshApiCall() {
  vi.resetModules();
  return (await import('./browser')).apiCall;
}

beforeEach(() => {
  vi.resetModules();
  assign.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { pathname: '/documents', search: '?folder=archive', assign, href: 'http://localhost/documents' },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

const unauthorized = () =>
  new Response(JSON.stringify({ detail: 'Your session has expired.' }), {
    status: 401, headers: { 'content-type': 'application/json' },
  });
const ok = (body: unknown = { items: [] }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('proxyPath', () => {
  it('rewrites /api/* to the session proxy', () => {
    expect(proxyPath('/api/documents/library')).toBe('/api/proxy/documents/library');
  });
  it('refuses traversal and non-api paths', () => {
    expect(proxyPath('/api/../secret')).toBeNull();
    expect(proxyPath('https://evil.test/api/x')).toBeNull();
  });
  it('apiCall refuses a non-/api path without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const apiCall = await freshApiCall();
    const res = await apiCall('/secret');
    expect(fetchMock).not.toHaveBeenCalled();
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('client');
  });
});

describe('401 → refresh → retry', () => {
  it('retries the original call once the refresh succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorized())                       // first attempt
      .mockResolvedValueOnce(new Response(null, { status: 200 }))  // /api/auth/refresh
      .mockResolvedValueOnce(ok({ items: [1] }));                  // retry
    vi.stubGlobal('fetch', fetchMock);

    const apiCall = await freshApiCall();
    const res = await apiCall<{ items: number[] }>('/api/documents/library');

    expect(res.ok).toBe(true);
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/proxy/documents/library', '/api/auth/refresh', '/api/proxy/documents/library',
    ]);
    expect(assign).not.toHaveBeenCalled();
  });

  it('redirects to /login carrying the current URL when the refresh fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response(null, { status: 401 })); // refresh rejected
    vi.stubGlobal('fetch', fetchMock);

    const apiCall = await freshApiCall();
    const res = await apiCall('/api/documents/library');

    expect(res.ok).toBe(false);
    expect(assign).toHaveBeenCalledWith('/login?next=' + encodeURIComponent('/documents?folder=archive'));
  });

  it('does not redirect a 403 — that is an entitlement problem, not a session one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Upgrade required' }), { status: 403 }),
    ));

    const apiCall = await freshApiCall();
    const res = await apiCall('/api/reports/exports');
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('forbidden');
    expect(assign).not.toHaveBeenCalled();
  });

  it('burns the rotating refresh token exactly once across concurrent 401s', async () => {
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        // The backend revokes the presented refresh token: a second
        // concurrent presentation would be rejected *and* kill the session.
        if (refreshCalls > 1) return new Response(null, { status: 401 });
        await new Promise(r => setTimeout(r, 5));
        return new Response(null, { status: 200 });
      }
      return refreshCalls > 0 ? ok() : unauthorized();
    }));

    const apiCall = await freshApiCall();
    const results = await Promise.all([
      apiCall('/api/documents/library'),
      apiCall('/api/documents/counts'),
      apiCall('/api/folders/tree'),
      apiCall('/api/templates'),
      apiCall('/api/contacts'),
      apiCall('/api/me'),
    ]);

    expect(refreshCalls).toBe(1);
    expect(results.every(r => r.ok)).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  it('never redirects when already on /login', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/login', search: '', assign, href: 'http://localhost/login' },
    });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(new Response(null, { status: 401 })));

    const apiCall = await freshApiCall();
    await apiCall('/api/me');
    expect(assign).not.toHaveBeenCalled();
  });
});
