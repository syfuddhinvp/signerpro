/**
 * `lib/api/resources.ts` — the URL table the whole UI addresses the backend by.
 *
 * A typo here is invisible in TypeScript (every path is a template string) and
 * shows up as a 404 in one screen. Two layers of protection:
 *
 *  1. a sweep over *every* exported endpoint function, asserting the path it
 *     builds is a real `/api/…` path with every segment interpolated;
 *  2. explicit assertions on the endpoints whose shape is easy to get wrong —
 *     the ones with a nested action, a PUT-that-wraps-its-body, or a query.
 */

import { describe, it, expect, vi } from 'vitest';
import * as resources from './resources';
import type { Caller } from './resources';
import type { ApiRequestInit } from './result';

type Recorded = { path: string; init: ApiRequestInit };

function recorder(): { calls: Recorded[]; call: Caller } {
  const calls: Recorded[] = [];
  const call = (async (path: string, init: ApiRequestInit = {}) => {
    calls.push({ path, init });
    return { ok: true as const, status: 200, data: undefined as never };
  }) as unknown as Caller;
  return { calls, call };
}

/** Every `export const <group> = { … }` in the module. */
const GROUPS = Object.entries(resources).filter(
  ([, value]) => value && typeof value === 'object',
) as [string, Record<string, unknown>][];

describe('every endpoint builds a real /api path', () => {
  const entries = GROUPS.flatMap(([group, table]) =>
    Object.entries(table)
      .filter(([, fn]) => typeof fn === 'function')
      // `*Path` helpers return a string for a link; they take no caller.
      .filter(([name]) => !name.endsWith('Path'))
      .map(([name, fn]) => [`${group}.${name}`, fn as (...args: unknown[]) => unknown] as const),
  );

  it('covers the whole module', () => {
    expect(entries.length).toBeGreaterThan(120);
  });

  /** Endpoints whose trailing argument is not an id/body — a multipart file. */
  const ARG_OVERRIDES: Record<string, unknown[]> = {
    'documents.uploadPdf': ['id-one', new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' })],
  };

  it.each(entries)('%s', (name, fn) => {
    const { calls, call } = recorder();
    // Positional ids first; anything further is a body or a params object.
    fn(call, ...(ARG_OVERRIDES[name] ?? ['id-one', 'id-two', 'id-three']));
    expect(calls).toHaveLength(1);
    const { path, init } = calls[0];
    expect(path.startsWith('/api/')).toBe(true);
    expect(path).not.toContain('undefined');
    expect(path).not.toContain('[object');
    expect(path).not.toMatch(/\/\//);
    expect(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).toContain(init.method);
  });

  it('documents.uploadPdf sends the file as multipart, not JSON', () => {
    const { calls, call } = recorder();
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'MSA.pdf', { type: 'application/pdf' });
    resources.documents.uploadPdf(call, 'doc_1', file);
    expect(calls[0].path).toBe('/api/documents/doc_1/upload-pdf');
    expect(calls[0].init.body).toBeUndefined();
    const sent = calls[0].init.formData?.get('upload');
    expect(sent).toBeInstanceOf(File);
    // The backend rejects a non-`.pdf` filename, so it has to survive the hop.
    expect((sent as File).name).toBe('MSA.pdf');
  });

  it('link helpers return paths, not calls', () => {
    expect(resources.documents.pdfPath('doc_1')).toBe('/api/documents/doc_1/pdf');
    expect(resources.documents.finalPdfPath('doc_1')).toBe('/api/documents/doc_1/final-pdf');
    expect(resources.documents.bulkDownloadPath()).toBe('/api/documents/bulk-download');
    expect(resources.invoices.pdfPath('inv_1')).toBe('/api/invoices/inv_1/pdf');
    expect(resources.invoices.receiptPath('inv_1')).toBe('/api/invoices/inv_1/receipt');
  });
});

describe('the endpoints that are easy to get wrong', () => {
  it('the certificate lives under /certificate/summary, not /certificate', () => {
    const { calls, call } = recorder();
    resources.audit.certificate(call, 'doc_1');
    expect(calls[0].path).toBe('/api/documents/doc_1/certificate/summary');
  });

  it('chain verification is a sub-resource of the trail', () => {
    const { calls, call } = recorder();
    resources.audit.documentTrail(call, 'doc_1');
    resources.audit.verifyChain(call, 'doc_1');
    expect(calls.map(c => c.path)).toEqual([
      '/api/documents/doc_1/audit-logs',
      '/api/documents/doc_1/audit-logs/verify',
    ]);
  });

  it('the library is a GET with params, not a POST search', () => {
    const { calls, call } = recorder();
    resources.documents.library(call, { quick: 'inbox', limit: 12, offset: 0 });
    expect(calls[0].path).toBe('/api/documents/library');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.query).toEqual({ quick: 'inbox', limit: 12, offset: 0 });
  });

  it('bulk field save is a PUT wrapping the items under `fields`', () => {
    const { calls, call } = recorder();
    resources.fields.bulkSave(call, 'doc_1', [{ field_type: 'signature' } as never]);
    expect(calls[0]).toMatchObject({
      path: '/api/documents/doc_1/fields',
      init: { method: 'PUT', body: { fields: [{ field_type: 'signature' }] } },
    });
  });

  it('recipient reorder posts ids under `recipient_ids`', () => {
    const { calls, call } = recorder();
    resources.recipients.reorder(call, 'doc_1', ['r2', 'r1']);
    expect(calls[0].init.body).toEqual({ recipient_ids: ['r2', 'r1'] });
  });

  it('void sends its reason as a query param, not a body', () => {
    const { calls, call } = recorder();
    resources.documents.void(call, 'doc_1', 'signed offline');
    expect(calls[0].init.query).toEqual({ reason: 'signed offline' });
    expect(calls[0].init.body).toBeUndefined();
  });

  it('platform logs and tenant logs are different endpoints', () => {
    const { calls, call } = recorder();
    resources.logs.tenant(call, { limit: 50 });
    resources.logs.platform(call, { limit: 50 });
    expect(calls.map(c => c.path)).toEqual(['/api/logs', '/api/saas/logs']);
  });

  it('seat changes send a delta, and plan changes a plan code', () => {
    const { calls, call } = recorder();
    resources.billing.changeSeats(call, 5);
    resources.billing.changePlan(call, 'business');
    expect(calls[0]).toMatchObject({ path: '/api/billing/seats', init: { body: { delta: 5 } } });
    expect(calls[1]).toMatchObject({ path: '/api/billing/change-plan', init: { body: { plan_code: 'business' } } });
  });

  it('cancel defaults to end-of-period rather than immediate', () => {
    const { calls, call } = recorder();
    resources.billing.cancel(call);
    expect(calls[0].init.body).toEqual({ at_period_end: true });
  });

  it('the invitation list keeps its trailing slash (FastAPI redirects otherwise)', () => {
    const { calls, call } = recorder();
    resources.invitations.list(call);
    expect(calls[0].path).toBe('/api/invitations/');
  });

  it('impersonation is started per tenant and stopped globally', () => {
    const { calls, call } = recorder();
    resources.tenants.impersonate(call, 'org_1', { justification: 'support' });
    resources.tenants.stopImpersonation(call);
    expect(calls[0].path).toBe('/api/saas/tenants/org_1/impersonate');
    expect(calls[1]).toMatchObject({ path: '/api/saas/impersonation', init: { method: 'DELETE' } });
  });

  it('ids are interpolated, never concatenated into the wrong segment', () => {
    const { calls, call } = recorder();
    resources.fields.update(call, 'doc_1', 'fld_9', { required: true } as never);
    resources.recipients.remove(call, 'doc_1', 'rcp_3');
    expect(calls[0].path).toBe('/api/documents/doc_1/fields/fld_9');
    expect(calls[1].path).toBe('/api/documents/doc_1/recipients/rcp_3');
  });
});

describe('the caller indirection', () => {
  it('a resource never imports a transport — it uses whichever it is handed', async () => {
    const server = vi.fn().mockResolvedValue({ ok: true, status: 200, data: [] });
    await resources.contacts.list(server as unknown as Caller, { limit: 200 } as never);
    expect(server).toHaveBeenCalledWith('/api/contacts', { method: 'GET', query: { limit: 200 } });
  });
});
