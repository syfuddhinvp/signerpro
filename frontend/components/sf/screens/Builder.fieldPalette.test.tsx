/**
 * The organization's field palette choice (ORG-6).
 *
 * The palette offers every field type the product implements, which is more
 * than most tenants ever place. An org admin narrows it under My account →
 * Organization, and the builder must honour that — including against the
 * search box and the Favourites tab, which are two other ways to reach a tile.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from './Builder';
import type { RecipientResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: () => <div data-pdf-page={1} />,
}));

const recipient: RecipientResponse = {
  id: 'rec-1', document_id: 'doc-7', name: 'Buyer', email: 'buyer@example.com', role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: 1, status: 'waiting',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null, otp_enabled: false,
  phone_number: null, otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

function mount() {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="MSA" pageCount={1} fields={[]} recipients={[recipient]} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

/** `enabled` is what `GET /api/organizations/me` reports; `null` is "all types". */
function serve(enabled: string[] | null, opts: { orgFails?: boolean; favorites?: string[] } = {}) {
  apiCall.mockImplementation(async (path: string) => {
    if (path === '/api/organizations/me') {
      return opts.orgFails
        ? { ok: false, status: 500, error: { message: 'down' } }
        : ok({ id: 'org-1', name: 'Acme', enabled_field_types: enabled });
    }
    if (path === '/api/me/field-favorites') return ok({ types: opts.favorites ?? ['signature'] });
    return ok([]);
  });
}

beforeEach(() => {
  apiCall.mockReset();
  serve(null);
});

describe('the organization’s field palette', () => {
  it('offers every type when the organization has not narrowed the palette', async () => {
    mount();
    await waitFor(() => expect(screen.getByLabelText(/^Place Signature/)).toBeTruthy());
    expect(screen.getByLabelText(/^Place Dropdown/)).toBeTruthy();
    expect(screen.getByLabelText(/^Place Stamp/)).toBeTruthy();
  });

  it('offers only the types the organization enabled', async () => {
    // Stored in the API's own names: `full_name` is the builder's `name`.
    serve(['signature', 'full_name', 'date']);
    mount();
    await waitFor(() => expect(screen.queryByLabelText(/^Place Dropdown/)).toBeNull());
    expect(screen.getByLabelText(/^Place Signature/)).toBeTruthy();
    expect(screen.getByLabelText(/^Place Full Name/)).toBeTruthy();
    expect(screen.getByLabelText(/^Place Date Signed/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Place Stamp/)).toBeNull();
  });

  it('does not let a disabled type be reached by searching for it', async () => {
    serve(['signature', 'date']);
    mount();
    await waitFor(() => expect(screen.queryByLabelText(/^Place Stamp/)).toBeNull());
    fireEvent.change(screen.getByLabelText('Search fields'), { target: { value: 'stamp' } });
    await waitFor(() => expect(screen.queryByLabelText(/^Place Stamp/)).toBeNull());
  });

  it('does not let a disabled type be reached through Favourites', async () => {
    // The star was set before the admin turned the type off.
    serve(['signature', 'date'], { favorites: ['stamp'] });
    mount();
    await waitFor(() => expect(screen.getByLabelText(/^Place Signature/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }));
    await waitFor(() => expect(screen.queryByLabelText(/^Place Stamp/)).toBeNull());
  });

  it('keeps the full palette when the organization cannot be loaded', async () => {
    // An author who cannot reach the API must still be able to place a field:
    // failing closed here would leave an empty rail with no way to recover.
    serve(null, { orgFails: true });
    mount();
    await waitFor(() => expect(screen.getByLabelText(/^Place Signature/)).toBeTruthy());
    expect(screen.getByLabelText(/^Place Dropdown/)).toBeTruthy();
  });
});
