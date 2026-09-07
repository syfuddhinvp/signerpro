/**
 * `lib/api/result.ts` — the single fetch every screen's data goes through.
 *
 * Protects: the discriminated `ApiError.kind` mapping (screens branch on it to
 * decide between "redirect to login", "you can't see this" and "degrade"), and
 * FastAPI's `detail[]` being parsed into `issues[]` so a form can point at a
 * field instead of showing one generic sentence.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  errorForStatus,
  requestJson,
  toQueryString,
  detailMessage,
  unwrapOr,
  isUnauthorized,
  errorMessage,
  apiOk,
  apiFail,
} from './result';

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(payload === undefined ? '' : JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('errorForStatus', () => {
  const cases: [number, string][] = [
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation'],
    [400, 'client'],
    [418, 'client'],
    [429, 'client'],
    [500, 'server'],
    [503, 'server'],
  ];
  it.each(cases)('maps %i → %s', (status, kind) => {
    expect(errorForStatus(status, { detail: 'nope' }).kind).toBe(kind);
  });

  it('prefers the backend detail string over the generic fallback', () => {
    expect(errorForStatus(409, { detail: 'Cannot demote the last org admin.' }).message)
      .toBe('Cannot demote the last org admin.');
  });

  it('falls back to human copy when there is no detail', () => {
    expect(errorForStatus(401, null).message).toBe('Your session has expired.');
    expect(errorForStatus(500, null).message).toBe('The SignerPro API returned an error.');
  });
});

describe('422 validation payloads', () => {
  it("parses FastAPI's detail[] into issues[]", () => {
    const error = errorForStatus(422, {
      detail: [
        { loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error' },
        { loc: ['body', 'password'], msg: 'ensure this value has at least 12 characters' },
      ],
    });
    expect(error.kind).toBe('validation');
    if (error.kind !== 'validation') throw new Error('unreachable');
    expect(error.issues).toHaveLength(2);
    expect(error.issues[0]).toEqual({
      loc: ['body', 'email'], msg: 'value is not a valid email address', type: 'value_error',
    });
    expect(error.issues[1].type).toBeUndefined();
    // The headline message is the first issue, not "Please check the details".
    expect(error.message).toBe('value is not a valid email address');
  });

  it('never throws on a malformed 422', () => {
    const error = errorForStatus(422, { detail: 'plain string' });
    expect(error.kind).toBe('validation');
    if (error.kind !== 'validation') throw new Error('unreachable');
    expect(error.issues).toEqual([]);
  });
});

describe('requestJson transport', () => {
  it('returns ok with the parsed body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { id: 'doc_1' })));
    const res = await requestJson<{ id: string }>('http://api/api/documents/doc_1');
    expect(res).toEqual({ ok: true, status: 200, data: { id: 'doc_1' } });
  });

  it('treats 204 as success with no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const res = await requestJson('http://api/api/documents/doc_1');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(204);
  });

  it('maps a thrown fetch to kind:network, not an exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const res = await requestJson('http://api/api/documents');
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('network');
    expect(res.error.status).toBe(0);
    expect(res.error.message).toBe('fetch failed');
  });

  it('maps a timeout to kind:network with timeout copy', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    const res = await requestJson('http://api/api/documents');
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('network');
    expect(res.error.message).toBe('The SignerPro API did not respond in time.');
  });

  it('attaches the bearer token and a JSON content-type on writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await requestJson('http://api/api/documents', { method: 'POST', body: { title: 'MSA' } }, 'tok_123');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer tok_123');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.body).toBe('{"title":"MSA"}');
  });

  it('never sends an authorization header without a token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await requestJson('http://api/api/documents');
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it('applies a default deadline so a hung backend cannot hang a render', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await requestJson('http://api/api/documents');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('returns text bodies that are not JSON without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })));
    const res = await requestJson('http://api/api/documents');
    if (res.ok) throw new Error('unreachable');
    expect(res.error.kind).toBe('server');
  });
});

describe('query serialisation', () => {
  it('drops null, undefined and empty-string params', () => {
    expect(toQueryString({ a: 1, b: null, c: undefined, d: '', e: false })).toBe('?a=1&e=false');
  });
  it('repeats array params', () => {
    expect(toQueryString({ id: ['a', 'b'] })).toBe('?id=a&id=b');
  });
  it('is empty when there is nothing to send', () => {
    expect(toQueryString(undefined)).toBe('');
    expect(toQueryString({ a: null })).toBe('');
  });
});

describe('result helpers', () => {
  it('unwrapOr degrades to the fallback', () => {
    expect(unwrapOr(apiOk(200, [1]), [])).toEqual([1]);
    expect(unwrapOr(apiFail<number[]>({ kind: 'server', status: 500, message: 'x' }), [])).toEqual([]);
  });
  it('isUnauthorized only fires on 401', () => {
    expect(isUnauthorized(apiFail({ kind: 'unauthorized', status: 401, message: 'x' }))).toBe(true);
    expect(isUnauthorized(apiFail({ kind: 'forbidden', status: 403, message: 'x' }))).toBe(false);
    expect(isUnauthorized(apiOk(200, 1))).toBe(false);
  });
  it('errorMessage is empty on success', () => {
    expect(errorMessage(apiOk(200, 1))).toBe('');
    expect(errorMessage(apiFail({ kind: 'server', status: 500, message: 'boom' }))).toBe('boom');
  });
  it('detailMessage falls through to the fallback', () => {
    expect(detailMessage({ nope: 1 }, 'fallback')).toBe('fallback');
    expect(detailMessage({ detail: [] }, 'fallback')).toBe('fallback');
  });
});

describe('detailMessage', () => {
  it('reads a structured billing detail, not just a string or a 422 list', () => {
    expect(detailMessage({ detail: 'Nope' }, 'fallback')).toBe('Nope');
    expect(detailMessage({ detail: [{ msg: 'field required' }] }, 'fallback')).toBe('field required');
    // `POST /api/documents` answers 402 with this shape when a plan has lapsed.
    expect(detailMessage(
      { detail: { error: 'subscription_inactive', message: 'Your subscription is expired.', plan: 'enterprise' } },
      'fallback',
    )).toBe('Your subscription is expired.');
    expect(detailMessage({ detail: { error: 'nope' } }, 'fallback')).toBe('fallback');
  });
});
