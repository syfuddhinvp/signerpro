/**
 * Adding and removing recipients on the prepare screen.
 *
 * The API layer has had `PUT/DELETE .../recipients` all along, but the builder
 * could only reorder and re-role the recipients an envelope already had — a
 * freshly uploaded PDF was stuck with an empty list and no way out of it.
 *
 * The rules the form encodes: email alone is enough (the API's required `name`
 * is derived from the address), the contact suggestions are a shortcut and not a
 * constraint, and whoever is added is kept in the tenant's address book.
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

const recipient = (id: string, name: string, email: string, order = 1): RecipientResponse => ({
  id, document_id: 'doc-7', name, email, role_name: null, role: 'sign', color: '#4f46e5',
  contact_id: null, signing_order: order, status: 'waiting', viewed_at: null, completed_at: null,
  declined_at: null, decline_reason: null, otp_enabled: false, phone_number: null,
  otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
});

const contact = (id: string, name: string, email: string) => ({
  id, organization_id: 'org-1', name, email, company: null, title: null, phone: null,
  default_role: 'sign', group: 'customers', source: 'manual', tags: [], color: null,
  envelope_count: 0, last_signed_at: null,
});

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });
const fail = (message: string, status = 400) => ({ ok: false, status, error: { kind: 'client', status, message } });

/** Per-endpoint stubs, so a test never depends on call ordering. */
type Stubs = {
  contacts?: ReturnType<typeof contact>[];
  setAll?: unknown;
  deleteRecipient?: unknown;
  createContact?: unknown;
};

function route(stubs: Stubs) {
  apiCall.mockImplementation(async (path: string, init: { method?: string } = {}) => {
    if (path === '/api/contacts' && (init.method ?? 'GET') === 'GET') {
      const items = stubs.contacts ?? [];
      return ok({ items, total: items.length, counts: { all: items.length } });
    }
    if (path === '/api/contacts' && init.method === 'POST') return stubs.createContact ?? ok(contact('c-new', 'X', 'x@y.io'), 201);
    if (path === '/api/documents/doc-7/recipients' && init.method === 'PUT') return stubs.setAll ?? ok([]);
    if (path.startsWith('/api/documents/doc-7/recipients/') && init.method === 'DELETE') return stubs.deleteRecipient ?? ok(undefined, 204);
    if (path === '/api/documents/doc-7/fields' && init.method === 'PUT') return ok([]);
    return ok(undefined);
  });
}

/** Calls to one endpoint+method, in order. */
const callsTo = (path: string, method = 'PUT') =>
  apiCall.mock.calls.filter(([p, init]) => p === path && (init?.method ?? 'GET') === method);

function mount(recipients: RecipientResponse[]) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="MSA" pageCount={1} fields={[]} recipients={recipients} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

const emailField = () => screen.getByLabelText('Recipient email');
const nameField = () => screen.getByLabelText('Recipient name (optional)');

/** Reveal the rail's form and type an address (and optionally a name). */
async function fillForm(email: string, name?: string) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Add recipient' })[0]);
  fireEvent.change(await screen.findByLabelText('Recipient email'), { target: { value: email } });
  if (name !== undefined) fireEvent.change(nameField(), { target: { value: name } });
}

const addNow = () => fireEvent.click(screen.getByRole('button', { name: 'Add' }));

beforeEach(() => {
  apiCall.mockReset();
  route({});
  resetNavigation();
});

/* Each case renders the whole builder (canvas, rails, both wizard steps) and
   drives it through several awaited round trips; 5s is tight on a loaded
   machine, and the failures were timeouts rather than wrong behaviour. */
describe('recipients on the prepare screen', { timeout: 20_000 }, () => {
  it('offers the control even on an envelope with nobody on it', () => {
    mount([]);
    expect(screen.getAllByRole('button', { name: 'Add recipient' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Nobody is on this envelope yet/)).toBeTruthy();
  });

  it('adds from the email alone, deriving the name the API requires', async () => {
    route({ setAll: ok([recipient('r-new', 'Sarah Mitchell', 'sarah.mitchell@acme.io')]) });
    mount([]);
    await fillForm('sarah.mitchell@acme.io');
    addNow();

    await waitFor(() => expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(1));
    const [, init] = callsTo('/api/documents/doc-7/recipients')[0];
    // No `id` for a row the server has not seen — that is what makes it a create.
    expect(init.body.recipients).toEqual([
      { name: 'Sarah Mitchell', email: 'sarah.mitchell@acme.io', signing_order: 1, role: 'sign', color: expect.any(String), role_name: null },
    ]);
    expect(await screen.findByText('Sarah Mitchell')).toBeTruthy();
  });

  it('keeps a name the sender did type', async () => {
    route({ setAll: ok([recipient('r-new', 'Dr. S. Mitchell', 'sarah@acme.io')]) });
    mount([]);
    await fillForm('sarah@acme.io', 'Dr. S. Mitchell');
    addNow();
    await waitFor(() => expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(1));
    expect(callsTo('/api/documents/doc-7/recipients')[0][1].body.recipients[0].name).toBe('Dr. S. Mitchell');
  });

  it('saves the recipient to the tenant contacts', async () => {
    route({ setAll: ok([recipient('r-new', 'Sarah Mitchell', 'sarah@acme.io')]) });
    mount([]);
    await fillForm('sarah@acme.io', 'Sarah Mitchell');
    addNow();

    await waitFor(() => expect(callsTo('/api/contacts', 'POST')).toHaveLength(1));
    expect(callsTo('/api/contacts', 'POST')[0][1].body).toEqual({
      name: 'Sarah Mitchell', email: 'sarah@acme.io', source: 'manual', default_role: 'sign',
    });
  });

  it('still adds the recipient when the contact write fails', async () => {
    route({
      setAll: ok([recipient('r-new', 'Sarah Mitchell', 'sarah@acme.io')]),
      createContact: fail('A contact with this email already exists', 409),
    });
    mount([]);
    await fillForm('sarah@acme.io');
    addNow();
    expect(await screen.findByText('Sarah Mitchell')).toBeTruthy();
  });

  it('suggests contacts as the address is typed and fills the email, not the id', async () => {
    route({ contacts: [contact('c1', 'Dana Whitfield', 'dana@northwind-legal.com')] });
    mount([]);
    await fillForm('dan');

    const option = await screen.findByRole('option', { name: /Dana Whitfield/ });
    fireEvent.click(option);
    await waitFor(() => expect((emailField() as HTMLInputElement).value).toBe('dana@northwind-legal.com'));
    expect((nameField() as HTMLInputElement).value).toBe('Dana Whitfield');
    // The contact search is a lookup only — nothing is written by picking.
    expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(0);
  });

  it('requires an email and nothing else', async () => {
    mount([]);
    await fillForm('', 'No Address');
    addNow();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(0);
  });

  it('refuses a duplicate email instead of letting the API 400', async () => {
    mount([recipient('r1', 'Sarah Mitchell', 'sarah@acme.io')]);
    await fillForm('SARAH@acme.io');
    addNow();
    await waitFor(() => expect(emailField()).toBeTruthy());
    expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(0);
  });

  it('rolls the row back when the write is rejected', async () => {
    route({ setAll: fail('Duplicate recipient email(s): sarah@acme.io') });
    mount([]);
    await fillForm('sarah@acme.io');
    addNow();
    await waitFor(() => expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(1));
    expect(screen.queryByText('Sarah Mitchell')).toBeNull();
    // A rejected recipient is not filed as a contact either.
    expect(callsTo('/api/contacts', 'POST')).toHaveLength(0);
  });

  it('removes a recipient through the replace while others remain', async () => {
    route({ setAll: ok([recipient('r2', 'Dev Patel', 'dev@acme.io', 1)]) });
    mount([recipient('r1', 'Sarah Mitchell', 'sarah@acme.io', 1), recipient('r2', 'Dev Patel', 'dev@acme.io', 2)]);
    fireEvent.click(screen.getByRole('button', { name: 'Set up and send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sarah Mitchell' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(1));
    const [, init] = callsTo('/api/documents/doc-7/recipients')[0];
    expect(init.body.recipients.map((r: { email: string }) => r.email)).toEqual(['dev@acme.io']);
  });

  it('deletes the last recipient one-by-one — the replace refuses an empty list', async () => {
    mount([recipient('r1', 'Sarah Mitchell', 'sarah@acme.io', 1)]);
    fireEvent.click(screen.getByRole('button', { name: 'Set up and send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sarah Mitchell' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(callsTo('/api/documents/doc-7/recipients/r1', 'DELETE')).toHaveLength(1));
    expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(0);
  });

  it('keeps the recipient when the removal is not confirmed', async () => {
    mount([recipient('r1', 'Sarah Mitchell', 'sarah@acme.io', 1)]);
    fireEvent.click(screen.getByRole('button', { name: 'Set up and send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Sarah Mitchell' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull());
    expect(callsTo('/api/documents/doc-7/recipients')).toHaveLength(0);
    expect(screen.getAllByText('Sarah Mitchell').length).toBeGreaterThan(0);
  });
});
