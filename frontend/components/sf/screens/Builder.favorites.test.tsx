/**
 * The palette's Favourites tab.
 *
 * `s.favTypes` was a hardcoded seed with nothing writing to it, so the tab was
 * decorative — there was no way to make a field a favourite. The star on each
 * tile now toggles it, and the set belongs to the account rather than to the
 * bundle.
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

const favoriteCalls = () =>
  apiCall.mock.calls.filter(([p, init]) => p === '/api/me/field-favorites' && init?.method === 'PUT');

function mount() {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="MSA" pageCount={1} fields={[]} recipients={[recipient]} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

/** The account starts with only Signature starred unless a test says otherwise. */
function serveFavorites(types: string[] = ['signature']) {
  const stored = { types };
  apiCall.mockImplementation(async (path: string, init?: { method?: string; body?: { types: string[] } }) => {
    if (path === '/api/me/field-favorites' && init?.method === 'PUT') {
      stored.types = init.body!.types;
      return ok({ types: stored.types });
    }
    if (path === '/api/me/field-favorites') return ok({ types: stored.types });
    return ok([]);
  });
}

beforeEach(() => {
  apiCall.mockReset();
  serveFavorites();
  vi.useRealTimers();
});

describe('starring a field type', () => {
  it('shows the account’s own favourites, not the bundled seed', async () => {
    serveFavorites(['stamp']);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }));
    await waitFor(() => expect(screen.getByLabelText(/^Place Stamp/)).toBeTruthy());
    expect(screen.queryByLabelText(/^Place Signature/)).toBeNull();
  });

  it('persists the star, in the API’s own field-type names', async () => {
    mount();
    const star = await screen.findByRole('button', { name: 'Add Full Name to favourites' });
    await waitFor(() => expect((star as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(star);

    await waitFor(() => expect(favoriteCalls().length).toBe(1));
    // The builder calls the type `name`; the API calls it `full_name`.
    expect(favoriteCalls()[0][1].body).toEqual({ types: ['signature', 'full_name'] });
    expect(screen.getByRole('button', { name: 'Remove Full Name from favourites' })).toBeTruthy();
  });

  it('un-stars a favourite again', async () => {
    mount();
    const star = await screen.findByRole('button', { name: 'Remove Signature from favourites' });
    await waitFor(() => expect((star as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(star);

    await waitFor(() => expect(favoriteCalls().length).toBe(1));
    expect(favoriteCalls()[0][1].body).toEqual({ types: [] });
  });

  it('puts the star back when the save fails', async () => {
    mount();
    const star = await screen.findByRole('button', { name: 'Add Stamp to favourites' });
    await waitFor(() => expect((star as HTMLButtonElement).disabled).toBe(false));
    apiCall.mockImplementation(async () => ({ ok: false, status: 500, error: { message: 'nope' } }));
    fireEvent.click(star);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Stamp to favourites' })).toBeTruthy());
  });

  it('says why the Favourites tab is empty rather than showing nothing', async () => {
    serveFavorites([]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Favourites' }));
    await waitFor(() => expect(screen.getByText(/No favourites yet/i)).toBeTruthy());
  });
});
