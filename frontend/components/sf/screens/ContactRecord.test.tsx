/**
 * One contact's record at `/contacts/<id>`.
 *
 * Two things are pinned here. Clearing a field must reach the API as an
 * explicit `null` — an omitted key leaves the old value in place, which is the
 * opposite of what the user just did — and the documents tab must say the
 * record has no envelopes rather than printing the prototype's invented four.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { toContact } from '@/lib/sf/adapters';
import type { ContactHistoryEntry, ContactResponse } from '@/lib/api/types';
import ContactRecord from './ContactRecord';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => null,
  useSession: () => ({
    userId: 'u-1', name: 'Ada', email: 'ada@acme.com', role: 'admin',
    organizationId: 'org-1', organizationName: 'Acme', isPlatformAdmin: false, impersonation: null,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const api = (over: Partial<ContactResponse> = {}): ContactResponse => ({
  id: 'ct-1', organization_id: 'org-1', name: 'Dana Signer', email: 'dana@customer.com',
  company: 'Customer Co', title: 'COO', phone: '+1 555 0100',
  address: '12 Harbour St, Boston MA', description: 'Signs the quarterly LOIs',
  default_role: 'sign', group: 'customers', source: 'manual', tags: ['vip'], color: '#0777CF',
  envelope_count: 2, last_signed_at: '2026-08-14T10:00:00Z', external_id: null,
  owner_name: 'Ada Owner', owner_email: 'ada@acme.com',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

function mount(contact: ContactResponse, history: ContactHistoryEntry[] = []) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <ContactRecord
        contact={toContact(contact)}
        history={history}
        groupLabels={{ customers: 'Customers' }}
        draftDocumentId={null}
      />
    </DialogProvider></SFProvider>,
  );
}

describe('the contact record', () => {
  beforeEach(() => { apiCall.mockReset(); });

  it('prints the enriched fields the CRM tab owns', () => {
    mount(api());
    expect(screen.getByText('12 Harbour St, Boston MA')).toBeTruthy();
    expect(screen.getByText('Signs the quarterly LOIs')).toBeTruthy();
    // Owner prefers the teammate's name over their sign-in address.
    expect(screen.getByText('Ada Owner')).toBeTruthy();
  });

  it('falls back to the owner’s email when the API has no name for them', () => {
    mount(api({ owner_name: null }));
    expect(screen.getByText('ada@acme.com')).toBeTruthy();
  });

  it('sends a cleared field as an explicit null', async () => {
    apiCall.mockResolvedValue({ ok: true, data: api({ description: null }) });
    mount(api());

    fireEvent.click(screen.getByRole('button', { name: /edit contact/i }));
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    const body = apiCall.mock.calls[0][1].body;
    expect(body.description).toBeNull();
    expect(body.address).toBe('12 Harbour St, Boston MA');
  });

  it('says a field is unset instead of leaving a dash across the page', () => {
    mount(api({ phone: null, company: null }));
    // The record groups its pairs now; an empty one reads as words, not "—".
    expect(screen.getAllByText('Not set').length).toBe(2);
  });

  it('makes the ways of reaching the contact actionable', () => {
    mount(api());
    const mail = screen.getByRole('link', { name: 'dana@customer.com' });
    expect(mail.getAttribute('href')).toBe('mailto:dana@customer.com');
    expect(screen.getByRole('link', { name: '+1 555 0100' }).getAttribute('href')).toBe('tel:+15550100');
  });

  it('says the contact has no envelopes rather than inventing some', () => {
    mount(api({ envelope_count: 0 }));
    fireEvent.click(screen.getByRole('tab', { name: /documents/i }));
    expect(screen.getByText(/no envelopes involving this contact yet/i)).toBeTruthy();
  });

  it('lists the envelopes the API returned', () => {
    mount(api(), [
      { document_id: 'doc-1', title: 'Purchase agreement', status: 'completed', event: 'signed', occurred_at: '2026-08-14T10:00:00Z' },
    ]);
    fireEvent.click(screen.getByRole('tab', { name: /documents/i }));
    expect(screen.getByText('Purchase agreement')).toBeTruthy();
    expect(screen.getByText(/signed · 14 Aug 2026/)).toBeTruthy();
  });
});
