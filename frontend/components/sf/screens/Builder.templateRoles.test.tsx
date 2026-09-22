/**
 * Documents made from a template, whose recipients start out as empty roles.
 *
 * The catalog seeds a blueprint with role placeholders that carry a `role_name`
 * and nothing else — no name, no address — and the form's fields are already
 * placed against them. `GET /recipients` hands those blanks back, so the full
 * replace has to be able to send them back unchanged (it used to 422 on the
 * empty email, which broke every add on such a document), and adding a person
 * has to *fill* a role rather than append beside it, or the fields would stay
 * assigned to nobody.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Builder from './Builder';
import type { RecipientResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const row = (over: Partial<RecipientResponse>): RecipientResponse => ({
  id: 'r1', document_id: 'doc-7', name: '', email: '', role_name: 'Employee', role: 'sign',
  color: '#4f46e5', contact_id: null, signing_order: 1, status: 'waiting', viewed_at: null,
  completed_at: null, declined_at: null, decline_reason: null, otp_enabled: false,
  phone_number: null, otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', ...over,
});

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

function route(setAll: unknown) {
  apiCall.mockImplementation(async (path: string, init: { method?: string } = {}) => {
    if (path === '/api/contacts' && (init.method ?? 'GET') === 'GET') return ok({ items: [], total: 0, counts: { all: 0 } });
    if (path === '/api/contacts' && init.method === 'POST') return ok({ id: 'c-new' }, 201);
    if (path === '/api/documents/doc-7/recipients' && init.method === 'PUT') return setAll;
    if (path === '/api/documents/doc-7/fields' && init.method === 'PUT') return ok([]);
    return ok(undefined);
  });
}

const putBodies = () =>
  apiCall.mock.calls
    .filter(([p, init]) => p === '/api/documents/doc-7/recipients' && init?.method === 'PUT')
    .map(([, init]) => init.body.recipients);

function mount(recipients: RecipientResponse[], isTemplate = false) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="Form I-9" pageCount={1} fields={[]}
        recipients={recipients} routing={null} isTemplate={isTemplate} />
    </DialogProvider></SFProvider>,
  );
}

async function add(email: string, name?: string) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Add recipient' })[0]);
  fireEvent.change(await screen.findByLabelText('Recipient email'), { target: { value: email } });
  if (name !== undefined) fireEvent.change(screen.getByLabelText('Recipient name (optional)'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

beforeEach(() => {
  apiCall.mockReset();
  route(ok([]));
  resetNavigation();
});

describe('inherited template roles', { timeout: 20_000 }, () => {
  it('names an unassigned role in the rail instead of showing a blank row', () => {
    mount([row({})]);
    expect(screen.getAllByText('Employee (unassigned)').length).toBeGreaterThan(0);
  });

  it('assigns the person to the empty role rather than adding a second recipient', async () => {
    route(ok([row({ name: 'Dev Soab', email: 'dev.soab@gmail.com' })]));
    mount([row({})]);
    await add('dev.soab@gmail.com', 'Dev Soab');

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    // One row, keyed by the placeholder's own id: the fields already placed
    // against that role stay placed, and its label survives the replace.
    expect(putBodies()[0]).toEqual([
      { id: 'r1', name: 'Dev Soab', email: 'dev.soab@gmail.com', signing_order: 1,
        role: 'sign', color: '#4f46e5', role_name: 'Employee' },
    ]);
  });

  it('fills the roles in signing order, one add at a time', async () => {
    const employee = row({});
    const employer = row({ id: 'r2', role_name: 'Employer representative', role: 'approve', signing_order: 2 });
    route(ok([row({ name: 'Dev Soab', email: 'dev.soab@gmail.com' }), employer]));
    mount([employee, employer]);
    await add('dev.soab@gmail.com', 'Dev Soab');

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    const sent = putBodies()[0];
    // The second role is still unassigned and goes back exactly as it came —
    // a blank email the endpoint has to accept, and not a duplicate of the
    // other blank either.
    expect(sent.map((r: { email: string }) => r.email)).toEqual(['dev.soab@gmail.com', '']);
    expect(sent[1]).toMatchObject({ id: 'r2', name: '', email: '', role_name: 'Employer representative' });
  });

  it('leaves the empty roles alone while the template itself is being authored', async () => {
    route(ok([row({}), row({ id: 'r2', name: 'Dev Soab', email: 'dev.soab@gmail.com', role_name: null, signing_order: 2 })]));
    mount([row({})], true);
    await add('dev.soab@gmail.com', 'Dev Soab');

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    // A blueprint's empty roles are its point: the new signer is appended.
    expect(putBodies()[0].map((r: { email: string }) => r.email)).toEqual(['', 'dev.soab@gmail.com']);
  });
});
