/**
 * PAY-1: the payment field's inspector and the envelope-level split UI.
 *
 * `signer_payment_service.sync_request` is the authority on every rule
 * mirrored here (allocation math, the Stripe minimum, a copy-only recipient
 * never owing money, a payer needing a placed field) — this pins that the
 * builder tells the sender about a refusal before Save, not after a 400.
 */
import React from 'react';
import { describe, it as vitestIt, expect, beforeEach, afterEach, vi } from 'vitest';

/* This suite mounts the whole Builder — pdf viewport measuring, the
   autosave debounce and org-level fetches all included — so a 5s default
   is tight under a loaded test run. Every test here gets the same longer
   budget `Builder.favorites.test.tsx` already needed for the same reason. */
const it = ((name: string, fn: () => void | Promise<void>) => vitestIt(name, fn, 10000)) as typeof vitestIt;
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import Builder from './Builder';
import type { FieldResponse, PaymentAccountResponse, RecipientResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const apiCall = vi.fn();
vi.mock('@/lib/api/browser', () => ({ apiCall: (...args: unknown[]) => apiCall(...args) }));

vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: ({ renderOverlay, pageBoxProps }: {
    renderOverlay?: (g: { page: number; widthPt: number; heightPt: number; scale: number; widthPx: number; heightPx: number }) => React.ReactNode;
    pageBoxProps?: (g: { page: number }) => Record<string, unknown>;
  }) => {
    const geometry = { page: 1, widthPt: 612, heightPt: 792, scale: 1, widthPx: 612, heightPx: 792 };
    const extra = pageBoxProps ? pageBoxProps(geometry) : {};
    return <div data-pdf-page={1} {...extra}>{renderOverlay ? renderOverlay(geometry) : null}</div>;
  },
}));

const buyer: RecipientResponse = {
  id: 'rec-1', document_id: 'doc-7', name: 'Buyer', email: 'buyer@example.com', role_name: null,
  role: 'sign', color: '#4f46e5', contact_id: null, signing_order: 1, status: 'waiting',
  viewed_at: null, completed_at: null, declined_at: null, decline_reason: null, otp_enabled: false,
  phone_number: null, otp_verified: false, consent_accepted: false, consent_accepted_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
};
const cosigner: RecipientResponse = { ...buyer, id: 'rec-2', name: 'Co-signer', email: 'co@example.com', signing_order: 2 };
const observer: RecipientResponse = { ...buyer, id: 'rec-3', name: 'Observer', email: 'observer@example.com', role: 'copy', signing_order: 3 };
const guarantor: RecipientResponse = { ...buyer, id: 'rec-4', name: 'Guarantor', email: 'guarantor@example.com', signing_order: 4 };

const paymentField = (id: string, recipientId: string): FieldResponse => ({
  id, document_id: 'doc-7', recipient_id: recipientId, type: 'payment', label: 'Payment',
  required: true, page_number: 1, x: 40, y: 40, width: 160, height: 48,
  placeholder: null, default_value: null, value: null, options: null, is_locked: false,
  validation: 'none', validation_pattern: null, condition: null, read_only: false,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
});

const chargesEnabledAccount: PaymentAccountResponse = {
  id: 'acct-1', organization_id: 'org-1', provider: 'stripe', provider_account_id: 'acct_stripe',
  charges_enabled: true, payouts_enabled: true, details_submitted: true, default_currency: 'usd',
  livemode: false, onboarded_at: '2026-08-01T00:00:00Z', last_synced_at: '2026-08-01T00:00:00Z', disabled_reason: null,
};

const ok = (data: unknown, status = 200) => ({ ok: true, status, data });

function mount(fields: FieldResponse[], recipients: RecipientResponse[] = [buyer, cosigner, observer]) {
  cleanup();
  return render(
    <SFProvider><DialogProvider>
      <Builder documentId="doc-7" title="MSA" pageCount={1} fields={fields} recipients={recipients} routing={null} />
    </DialogProvider></SFProvider>,
  );
}

const savedFields = () =>
  apiCall.mock.calls.filter(([p, init]) => p === '/api/documents/doc-7/fields' && init?.method === 'PUT');
const savedPaymentRequests = () =>
  apiCall.mock.calls.filter(([p, init]) => p === '/api/documents/doc-7/payment-request' && init?.method === 'PUT');

beforeEach(() => {
  apiCall.mockReset();
  apiCall.mockImplementation(async (path: string) => {
    if (path === '/api/payments/account') return ok(chargesEnabledAccount);
    if (path === '/api/documents/doc-7/payment-request') return ok(null);
    return ok([]);
  });
  vi.useRealTimers();
});
afterEach(() => cleanup());

describe('lazy loading', () => {
  const paymentCalls = () => apiCall.mock.calls.filter(([p]) =>
    p === '/api/payments/account' || p === '/api/documents/doc-7/payment-request');

  it('never calls the payments endpoints when there is no payment field and the panel is unopened', async () => {
    mount([]);
    await screen.findByLabelText(/Place Payment — drag onto the page/i);
    expect(paymentCalls().length).toBe(0);
  });

  it('calls the payments endpoints once when the document already has a payment field', async () => {
    mount([paymentField('fld-1', 'rec-1')]);
    await waitFor(() => expect(paymentCalls().length).toBe(2));
    expect(paymentCalls().filter(([p]) => p === '/api/payments/account').length).toBe(1);
    expect(paymentCalls().filter(([p]) => p === '/api/documents/doc-7/payment-request').length).toBe(1);
  });
});

describe('the palette', () => {
  it('offers Payment as a field to place', () => {
    mount([]);
    expect(screen.getByLabelText(/Place Payment — drag onto the page/i)).toBeTruthy();
  });
});

describe('a single payment field', () => {
  it('sends a fixed amount typed in dollars as integer cents', async () => {
    mount([paymentField('fld-1', 'rec-1')]);
    fireEvent.pointerDown(screen.getByLabelText(/Payment for Buyer/i));
    fireEvent.change(screen.getByLabelText(/Amount \(USD\)/i), { target: { value: '50.00' } });

    await waitFor(() => expect(savedFields().length).toBeGreaterThan(0), { timeout: 3000 });
    const body = savedFields().at(-1)![1].body as { fields: { options: { amount_cents: number } }[] };
    expect(body.fields[0].options.amount_cents).toBe(5000);
  });
});

describe('the envelope payment panel', () => {
  const openPanel = async (fields: FieldResponse[], recipients?: RecipientResponse[]) => {
    mount(fields, recipients);
    // Step 2 (routing/send) is where the payment panel lives.
    fireEvent.click(await screen.findByText('Set up and send'));
    await screen.findByText('Payment request');
  };

  it('splits an even total exactly across the payers selected', async () => {
    await openPanel([
      paymentField('fld-1', 'rec-1'),
      paymentField('fld-2', 'rec-2'),
    ]);
    fireEvent.change(screen.getByLabelText(/Total amount/i), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Split equally' }));
    fireEvent.click(screen.getByLabelText('Charge Buyer'));
    fireEvent.click(screen.getByLabelText('Charge Co-signer'));

    expect(screen.getAllByText(/USD 50\.00/).length).toBe(2);
  });

  it('shows the exact remainder cents for $100.00 split three ways — 33.34/33.33/33.33, not three equal 33.33s', async () => {
    await openPanel([
      paymentField('fld-1', 'rec-1'),
      paymentField('fld-2', 'rec-2'),
      paymentField('fld-3', 'rec-4'),
    ], [buyer, cosigner, guarantor]);
    fireEvent.change(screen.getByLabelText(/Total amount/i), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Split equally' }));
    fireEvent.click(screen.getByLabelText('Charge Buyer'));
    fireEvent.click(screen.getByLabelText('Charge Co-signer'));
    fireEvent.click(screen.getByLabelText('Charge Guarantor'));

    // The earliest-selected payer (Buyer) takes the odd cent.
    expect(screen.getAllByText(/USD 33\.34/).length).toBe(1);
    expect(screen.getAllByText(/USD 33\.33/).length).toBe(2);
  });

  it('blocks Save when a custom split does not sum to the total', async () => {
    await openPanel([
      paymentField('fld-1', 'rec-1'),
      paymentField('fld-2', 'rec-2'),
    ]);
    fireEvent.change(screen.getByLabelText(/Total amount/i), { target: { value: '100.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Custom split' }));
    fireEvent.click(screen.getByLabelText('Charge Buyer'));
    fireEvent.click(screen.getByLabelText('Charge Co-signer'));
    fireEvent.change(screen.getByLabelText('Buyer’s amount'), { target: { value: '40.00' } });
    fireEvent.change(screen.getByLabelText('Co-signer’s amount'), { target: { value: '40.00' } });

    expect(screen.getByText(/must equal the total/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save payment request/i }));
    expect(savedPaymentRequests().length).toBe(0);
  });

  it('will not let a copy-only recipient be selected to pay', async () => {
    await openPanel([paymentField('fld-1', 'rec-1')]);
    expect(screen.queryByLabelText('Charge Observer')).toBeNull();
  });

  it('warns when the organization has no chargeable Stripe account', async () => {
    apiCall.mockImplementation(async (path: string) => {
      if (path === '/api/payments/account') return ok(null);
      if (path === '/api/documents/doc-7/payment-request') return ok(null);
      return ok([]);
    });
    await openPanel([paymentField('fld-1', 'rec-1')]);
    expect(screen.getByText(/cannot be sent for payment yet/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Go to Payments/i })).toHaveAttribute('href', '/account/payments');
  });
});
