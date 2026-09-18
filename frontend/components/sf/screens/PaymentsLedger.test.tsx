/**
 * The tenant-wide payments ledger (PAY-2).
 *
 * Before it, money a signer paid was visible only from inside one envelope's
 * audit page, and refunding only reachable there — so a tenant collecting
 * across many envelopes had nowhere to see what they had taken, reconcile it,
 * or return any of it, and it read as though no record of payments existed.
 *
 * These tests pin the three things this screen must never do, each a real
 * failure mode of what it replaces: show refunded money as collected, sum
 * across currencies, or present a receipt whose row no longer matches its
 * checksum as if it were intact. Plus the admin-only refund with its
 * "cannot be undone" confirmation.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import type {
  PaymentLedgerEntry, PaymentLedgerPage, PaymentReceiptResponse, SignerPaymentResponse,
} from '@/lib/api/types';
import PaymentsLedger from './PaymentsLedger';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

let sessionRole = 'admin';
vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => ({
    userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: sessionRole,
    organizationId: 'o1', organizationName: 'Northwind', isPlatformAdmin: false, impersonation: null,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

const apiCall = vi.fn();
const apiDownload = vi.fn();
const saveBlob = vi.fn();
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return {
    ...actual,
    apiCall: (...args: unknown[]) => apiCall(...args),
    apiDownload: (...args: unknown[]) => apiDownload(...args),
    saveBlob: (...args: unknown[]) => saveBlob(...args),
  };
});

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (message = 'boom') => ({ ok: false as const, error: { kind: 'server', status: 500, message } });

function payment(over: Partial<SignerPaymentResponse> = {}): SignerPaymentResponse {
  return {
    id: 'pay-1', organization_id: 'o1', document_id: 'doc-1', recipient_id: 'r1', field_id: 'f1',
    payment_request_id: null, amount_cents: 10000, currency: 'usd', status: 'succeeded',
    provider: 'stripe', provider_payment_intent_id: 'pi_1', provider_charge_id: 'ch_1',
    receipt_url: 'https://stripe.test/r/1', failure_code: null, failure_message: null,
    paid_at: '2026-09-01T10:00:00Z', refunded_at: null, refunded_amount_cents: 0,
    description: 'Deposit', created_at: '2026-09-01T10:00:00Z', ...over,
  };
}

function receipt(over: Partial<PaymentReceiptResponse> = {}): PaymentReceiptResponse {
  return {
    id: 'rcp-1', organization_id: 'o1', signer_payment_id: 'pay-1', document_id: 'doc-1',
    document_ref: 'doc-1', recipient_id: 'r1', number: 'RCP-2026-000001', status: 'issued',
    currency: 'usd', subtotal_cents: 10000, tax_cents: 0, total_cents: 10000,
    refunded_amount_cents: 0, net_cents: 10000, payer_name: 'Alice Payer',
    payer_email: 'alice@example.com', document_title: 'Buyer Packet', issuer_name: 'Northwind',
    description: 'Deposit', line_items: null, provider: 'stripe', provider_account_id: 'acct_1',
    provider_payment_intent_id: 'pi_1', provider_charge_id: 'ch_1',
    provider_receipt_url: 'https://stripe.test/r/1', issued_at: '2026-09-01T10:00:00Z',
    paid_at: '2026-09-01T10:00:00Z', refunded_at: null, checksum: 'a'.repeat(64),
    audit_log_id: 'al-1', verified: true, ...over,
  };
}

function entry(over: Partial<PaymentLedgerEntry> = {}): PaymentLedgerEntry {
  return {
    payment: payment(), receipt: receipt(), document_id: 'doc-1',
    document_title: 'Buyer Packet', document_status: 'completed',
    payer_name: 'Alice Payer', payer_email: 'alice@example.com', ...over,
  };
}

function page(over: Partial<PaymentLedgerPage> = {}): PaymentLedgerPage {
  return {
    entries: [entry()], total: 1, limit: 50, offset: 0,
    collected_cents_by_currency: { USD: 10000 }, refunded_cents_by_currency: {},
    succeeded_count: 1, refunded_count: 0, failed_count: 0, ...over,
  };
}

function mount(props: Partial<React.ComponentProps<typeof PaymentsLedger>> = {}) {
  return render(
    <SFProvider>
      <DialogProvider>
        <PaymentsLedger page={page()} {...props} />
      </DialogProvider>
    </SFProvider>,
  );
}

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
  apiDownload.mockReset();
  saveBlob.mockReset();
  sessionRole = 'admin';
});

describe('the payments ledger', () => {
  it('lists a payment with its payer, envelope and receipt number', () => {
    mount();
    expect(screen.getByText(/Alice Payer/)).toBeTruthy();
    expect(screen.getByText(/Buyer Packet/)).toBeTruthy();
    expect(screen.getByText(/RCP-2026-000001/)).toBeTruthy();
    expect(screen.getByText(/Net collected · USD/)).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
  });

  it('shows the net figure, not the gross, once money has been refunded', () => {
    /* A refunded payment showing as collected is the single most misleading
       thing a finance view can do. */
    mount({
      page: page({
        entries: [entry({
          payment: payment({ refunded_amount_cents: 4000 }),
          receipt: receipt({ status: 'partially_refunded', refunded_amount_cents: 4000, net_cents: 6000 }),
        })],
        collected_cents_by_currency: { USD: 6000 },
        refunded_cents_by_currency: { USD: 4000 },
      }),
    });
    expect(screen.getByText('$60.00')).toBeTruthy();
    // Appears twice on purpose: once on the currency tile, once on the row.
    expect(screen.getAllByText(/\$40\.00 refunded/).length).toBeGreaterThan(0);
  });

  it('keeps currencies apart instead of summing them into one number', () => {
    mount({
      page: page({
        entries: [
          entry(),
          entry({ payment: payment({ id: 'pay-2', currency: 'eur', amount_cents: 5000 }), receipt: null }),
        ],
        collected_cents_by_currency: { USD: 10000, EUR: 5000 },
        succeeded_count: 2,
      }),
    });
    expect(screen.getByText(/Net collected · USD/)).toBeTruthy();
    expect(screen.getByText(/Net collected · EUR/)).toBeTruthy();
    expect(screen.getByText('$100.00')).toBeTruthy();
    expect(screen.getByText('€50.00')).toBeTruthy();
  });

  it('flags a receipt whose stored row no longer matches its checksum', () => {
    mount({ page: page({ entries: [entry({ receipt: receipt({ verified: false }) })] }) });
    expect(screen.getByText(/checksum mismatch/)).toBeTruthy();
  });

  it('says a settled payment needs the backfill when it has no receipt', () => {
    /* Distinguishes "this predates receipts" from "this never settled" —
       they need different actions. */
    mount({ page: page({ entries: [entry({ receipt: null })] }) });
    expect(screen.getByText(/needs backfill/)).toBeTruthy();
  });

  it('downloads the receipt pdf by its number', async () => {
    apiDownload.mockResolvedValue(ok({ blob: new Blob(['x']), filename: 'RCP-2026-000001.pdf' }));
    mount();
    fireEvent.click(screen.getByText(/RCP-2026-000001/));
    await waitFor(() => expect(apiDownload).toHaveBeenCalled());
    expect(apiDownload.mock.calls[0][0]).toBe('/api/payments/receipts/rcp-1/pdf');
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
  });

  it('keeps Stripe\'s hosted receipt only as a secondary cross-reference', () => {
    mount();
    const stripeLink = screen.getByText(/Stripe receipt/).closest('a');
    expect(stripeLink?.getAttribute('href')).toBe('https://stripe.test/r/1');
  });

  it('renders an unreachable ledger as an error, never as "no payments yet"', () => {
    mount({ page: null, loadError: 'upstream down' });
    expect(screen.getByText(/Could not load the ledger/)).toBeTruthy();
    expect(screen.queryByText(/No signer payments yet/)).toBeNull();
  });

  it('shows an empty ledger plainly when the call succeeded', () => {
    mount({ page: page({ entries: [], total: 0, collected_cents_by_currency: {}, succeeded_count: 0 }) });
    expect(screen.getByText(/No signer payments yet/)).toBeTruthy();
  });
});

describe('refunding from the ledger', () => {
  it('offers refund to an admin and requires an explicit confirmation', async () => {
    apiCall.mockResolvedValue(ok(payment({ refunded_amount_cents: 10000, status: 'refunded' })));
    mount();

    fireEvent.click(screen.getByRole('button', { name: /^refund$/i }));

    // Amount prompt first; blank means the full remaining balance.
    const amountDialog = await screen.findByRole('dialog', { name: /refund amount/i });
    fireEvent.change(within(amountDialog).getByLabelText(/amount/i), { target: { value: '' } });
    fireEvent.click(within(amountDialog).getByRole('button', { name: /save|confirm/i }));

    // Then a confirmation naming the amount, the payer, the receipt it will
    // update, and that it cannot be undone.
    const confirmDialog = await screen.findByRole('dialog', { name: /refund/i });
    expect(within(confirmDialog).getByText(/cannot be undone/i)).toBeTruthy();
    expect(within(confirmDialog).getByText(/Alice Payer/)).toBeTruthy();
    expect(within(confirmDialog).getByText(/RCP-2026-000001/)).toBeTruthy();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^refund$/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    expect(apiCall.mock.calls[0][0]).toBe('/api/payments/pay-1/refund');
  });

  it('hides refund from a non-admin rather than offering a call that would 403', () => {
    sessionRole = 'member';
    mount();
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it('does not offer refund when nothing is left to refund', () => {
    mount({
      page: page({
        entries: [entry({
          payment: payment({ status: 'refunded', refunded_amount_cents: 10000 }),
          receipt: receipt({ status: 'refunded', refunded_amount_cents: 10000, net_cents: 0 }),
        })],
      }),
    });
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it('leaves the row refundable when the refund call fails', async () => {
    /* The failure notice itself is a flash, rendered by the app layout rather
       than this tree. What is observable here is what matters: the button
       comes back out of its "Refunding…" state, so the operator can see the
       money did not move and try again. */
    apiCall.mockResolvedValue(fail('card network unavailable'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^refund$/i }));
    const amountDialog = await screen.findByRole('dialog', { name: /refund amount/i });
    fireEvent.change(within(amountDialog).getByLabelText(/amount/i), { target: { value: '' } });
    fireEvent.click(within(amountDialog).getByRole('button', { name: /save|confirm/i }));
    const confirmDialog = await screen.findByRole('dialog', { name: /refund/i });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^refund$/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /^refund$/i })).toBeTruthy());
  });

  it('refuses a partial amount above the remaining balance', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^refund$/i }));
    const amountDialog = await screen.findByRole('dialog', { name: /refund amount/i });
    fireEvent.change(within(amountDialog).getByLabelText(/amount/i), { target: { value: '250' } });
    fireEvent.click(within(amountDialog).getByRole('button', { name: /save|confirm/i }));

    // No confirmation is offered and nothing is sent: an amount above the
    // remaining balance is rejected before it can reach Stripe, which would
    // otherwise fail server-side anyway but only after a confirm that told
    // the operator the refund was about to happen.
    await waitFor(() => expect(screen.queryByText(/cannot be undone/i)).toBeNull());
    expect(apiCall).not.toHaveBeenCalled();
  });
});
