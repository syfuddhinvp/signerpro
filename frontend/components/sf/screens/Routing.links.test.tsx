/**
 * Per-signer link actions on the workflow screen.
 *
 * The API has had `POST .../recipients/{id}/resend` all along, but nothing in
 * the UI called it: a sender whose signer had lost the email, or who wanted to
 * pass the link through a chat, had no way to do either.
 *
 * Both share one endpoint, and both supersede that recipient's previous link —
 * `notify=false` is the only difference, and it exists so copying a link does
 * not also put a second copy of it in the signer's inbox.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Routing from './Routing';
import type { RecipientResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

const writeText = vi.fn(() => Promise.resolve());

const recipient = (id: string, name: string, email: string): RecipientResponse => ({
  id, document_id: 'doc-7', name, email, role_name: null, role: 'sign', color: '#4f46e5',
  contact_id: null, signing_order: 1, status: 'sent', viewed_at: null, completed_at: null,
  declined_at: null, decline_reason: null, otp_enabled: false, phone_number: null,
  otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
});

const link = 'http://localhost:3000/sign/tok-123';
const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

function mount(recipients: RecipientResponse[]) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Routing documentId="doc-7" title="MSA" recipients={recipients} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

const resendCalls = () => apiCall.mock.calls.filter(([p]) => String(p).includes('/resend'));

beforeEach(() => {
  apiCall.mockReset();
  writeText.mockClear();
  // Routed per endpoint: the recipient picker also lists contacts, and handing
  // it the resend payload leaves it retrying a shape it cannot read.
  apiCall.mockImplementation(async (path: string) => {
    if (String(path).startsWith('/api/contacts')) return ok({ items: [], total: 0, counts: { all: 0 } });
    return ok({ email: 'buyer@example.com', signing_link: link });
  });
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('resend and copy link, per signer', () => {
  it('resends the signing email to that recipient', async () => {
    mount([recipient('rec-1', 'Buyer', 'buyer@example.com')]);
    fireEvent.click(screen.getByLabelText('Resend the signing email to Buyer'));
    await waitFor(() => expect(resendCalls().length).toBe(1));
    // No `notify=false`: this one is meant to send the email.
    expect(resendCalls()[0][0]).toBe('/api/documents/doc-7/recipients/rec-1/resend');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies a link without sending an email', async () => {
    mount([recipient('rec-1', 'Buyer', 'buyer@example.com')]);
    fireEvent.click(screen.getByLabelText('Copy the signing link for Buyer'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(link));
    expect(resendCalls()[0][0]).toBe('/api/documents/doc-7/recipients/rec-1/resend?notify=false');
  });

  it('acts on the signer whose button was pressed', async () => {
    mount([recipient('rec-1', 'Buyer', 'buyer@example.com'), recipient('rec-2', 'Seller', 'seller@example.com')]);
    fireEvent.click(screen.getByLabelText('Copy the signing link for Seller'));
    await waitFor(() => expect(resendCalls().length).toBe(1));
    expect(resendCalls()[0][0]).toContain('/recipients/rec-2/resend');
  });

  it('copies nothing when the API refuses', async () => {
    apiCall.mockImplementation(async () => ({
      ok: false, status: 400,
      error: { kind: 'client', status: 400, message: 'Cannot resend signing link for a document that is not active.' },
    }));
    mount([recipient('rec-1', 'Buyer', 'buyer@example.com')]);
    fireEvent.click(screen.getByLabelText('Copy the signing link for Buyer'));
    await waitFor(() => expect(resendCalls().length).toBe(1));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('offers neither action for a recipient the API has never seen', () => {
    mount([]);
    fireEvent.click(screen.getByRole('button', { name: /add recipient/i }));
    expect(screen.queryByLabelText(/Copy the signing link/)).toBeNull();
  });
});
