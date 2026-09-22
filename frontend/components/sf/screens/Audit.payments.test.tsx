/**
 * The payments panel on the sender's document-detail (audit trail) view, plus
 * the money-aware void warning. Voiding an envelope must never move money by
 * itself, but it must be impossible to miss that money is still held — this
 * pins the partial-collection state, the admin-only refund action with its
 * "cannot be undone" confirmation, and the void warning naming the amount.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import type { PaymentReceiptResponse, PaymentRequestResponse, SignerPaymentResponse } from '@/lib/api/types';
import Audit, { type AuditProps, type PayerRef } from './Audit';

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
vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return { ...actual, apiCall: (...args: unknown[]) => apiCall(...args) };
});

function mount(props: Partial<AuditProps> = {}) {
  const defaults: AuditProps = {
    documentId: 'doc-1',
    documentStatus: 'sent',
    entries: [],
    certificate: null,
    chain: null,
    attestations: [],
    documentTitle: 'Buyer Seller Packet',
    verifyUrl: '',
    sealed: false,
    paymentSummary: null,
    payments: [],
    payers: [],
  };
  return render(
    <SFProvider>
      <DialogProvider>
        <Audit {...defaults} {...props} />
      </DialogProvider>
    </SFProvider>,
  );
}

const ok = <T,>(data: T) => ({ ok: true as const, data });

const payers: PayerRef[] = [
  { id: 'r1', name: 'Alice Signer', email: 'alice@example.com' },
  { id: 'r2', name: 'Bob Signer', email: 'bob@example.com' },
];

const summary = (over: Partial<PaymentRequestResponse> = {}): PaymentRequestResponse => ({
  id: 'pr-1', document_id: 'doc-1', organization_id: 'org-1', total_cents: 100000, currency: 'usd',
  memo: null, split_mode: 'equal', created_by_user_id: 'u1',
  collected_cents: 75000, paid_count: 3, allocation_count: 4,
  ...over,
});

const payment = (over: Partial<SignerPaymentResponse> = {}): SignerPaymentResponse => ({
  id: 'sp-1', organization_id: 'org-1', document_id: 'doc-1', recipient_id: 'r1', field_id: 'f1',
  payment_request_id: 'pr-1', amount_cents: 25000, currency: 'usd', status: 'succeeded',
  provider: 'stripe', provider_payment_intent_id: 'pi_1', provider_charge_id: 'ch_1',
  receipt_url: 'https://example.com/receipt', failure_code: null, failure_message: null,
  paid_at: '2026-01-01T00:00:00Z', refunded_at: null, refunded_amount_cents: 0, description: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

const receipt = (over: Partial<PaymentReceiptResponse> = {}): PaymentReceiptResponse => ({
  id: 'rcp-1', organization_id: 'org-1', signer_payment_id: 'sp-1', document_id: 'doc-1',
  document_ref: 'doc-1', recipient_id: 'r1', number: 'RCP-2026-000001', status: 'issued',
  currency: 'usd', subtotal_cents: 25000, tax_cents: 0, total_cents: 25000,
  refunded_amount_cents: 0, net_cents: 25000, payer_name: 'Alice Signer',
  payer_email: 'alice@example.com', document_title: 'Buyer Seller Packet',
  issuer_name: 'Northwind', description: null, line_items: null, provider: 'stripe',
  provider_account_id: 'acct_1', provider_payment_intent_id: 'pi_1', provider_charge_id: 'ch_1',
  provider_receipt_url: 'https://example.com/receipt', issued_at: '2026-01-01T00:00:00Z',
  paid_at: '2026-01-01T00:00:00Z', refunded_at: null, checksum: 'a'.repeat(64),
  audit_log_id: 'al-1', verified: true,
  ...over,
});

beforeEach(() => {
  cleanup();
  resetNavigation();
  apiCall.mockReset();
  sessionRole = 'admin';
});

describe('Audit · payments panel', () => {
  it('renders the partial-collection state', () => {
    mount({ paymentSummary: summary(), payments: [payment()], payers });
    const panel = screen.getByTestId('payments-panel');
    expect(within(panel).getByText(/750\.00 USD of 1000\.00 USD/)).toBeInTheDocument();
    expect(within(panel).getByText(/3 of 4 paid/)).toBeInTheDocument();
    expect(within(panel).getByText('Alice Signer')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /stripe receipt/i })).toHaveAttribute('href', 'https://example.com/receipt');
  });

  it('offers the tenant\'s own receipt, with Stripe\'s page as the secondary reference', () => {
    /* The Stripe link used to be the ONLY evidence of the money: a page on
       the tenant's connected account that this app does not host and loses
       when they disconnect it, while the certificate printed "Paid"
       regardless. The numbered internal receipt is now the document. */
    mount({
      paymentSummary: summary(),
      payments: [payment({ receipt: receipt() })],
      payers,
    });
    const panel = screen.getByTestId('payments-panel');
    expect(within(panel).getByRole('button', { name: /RCP-2026-000001/ })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /stripe receipt/i })).toBeInTheDocument();
  });

  it('flags a receipt whose stored row no longer matches its checksum', () => {
    mount({
      paymentSummary: summary(),
      payments: [payment({ receipt: receipt({ verified: false }) })],
      payers,
    });
    expect(within(screen.getByTestId('payments-panel')).getByText(/checksum mismatch/i)).toBeInTheDocument();
  });

  it('does not render a panel when nothing was ever requested', () => {
    mount({ paymentSummary: null, payments: [] });
    expect(screen.queryByTestId('payments-panel')).not.toBeInTheDocument();
  });

  it('shows refunded payments as refunded, with the refunded figure', () => {
    mount({
      paymentSummary: summary(),
      payments: [payment({ status: 'refunded', refunded_amount_cents: 25000 })],
      payers,
    });
    const panel = screen.getByTestId('payments-panel');
    expect(within(panel).getByText('refunded')).toBeInTheDocument();
    expect(within(panel).getByText(/250\.00 USD refunded/)).toBeInTheDocument();
    // Nothing left to give back, so no refund button.
    expect(within(panel).queryByRole('button', { name: /^refund$/i })).not.toBeInTheDocument();
  });

  it('hides the refund action from a non-admin', () => {
    sessionRole = 'sender';
    mount({ paymentSummary: summary(), payments: [payment()], payers });
    const panel = screen.getByTestId('payments-panel');
    expect(within(panel).queryByRole('button', { name: /^refund$/i })).not.toBeInTheDocument();
  });

  it('confirms a partial refund, states the amount and that it cannot be undone, then calls the API', async () => {
    apiCall.mockResolvedValue(ok(payment({ status: 'succeeded', refunded_amount_cents: 10000 })));
    mount({ paymentSummary: summary(), payments: [payment()], payers });

    fireEvent.click(screen.getByRole('button', { name: /^refund$/i }));

    const amountDialog = await screen.findByRole('dialog', { name: /refund amount/i });
    fireEvent.change(within(amountDialog).getByLabelText(/amount/i), { target: { value: '100.00' } });
    fireEvent.click(within(amountDialog).getByRole('button', { name: /save|confirm/i }));

    const confirmDialog = await screen.findByRole('dialog', { name: /refund 100\.00 usd/i });
    expect(within(confirmDialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/alice signer/i)).toBeInTheDocument();
    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^refund$/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalledWith(
      '/api/payments/sp-1/refund',
      expect.objectContaining({ method: 'POST', body: { amount_cents: 10000 } }),
    ));
  });
});

describe('Audit · void warns about held money', () => {
  it('states the amount and payers held before voiding, and does not call refund itself', async () => {
    apiCall.mockResolvedValue(ok({ id: 'doc-1', status: 'voided' }));
    mount({
      documentStatus: 'sent',
      paymentSummary: summary(),
      payments: [payment({ recipient_id: 'r1' }), payment({ id: 'sp-2', recipient_id: 'r2', amount_cents: 50000 })],
      payers,
    });

    fireEvent.click(screen.getByRole('button', { name: /void envelope/i }));

    const dialog = await screen.findByRole('dialog', { name: /void this envelope/i });
    expect(within(dialog).getByText(/750\.00 USD/)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not refund it/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /void envelope/i }));

    await waitFor(() => expect(apiCall).toHaveBeenCalledWith(
      '/api/documents/doc-1/void',
      expect.objectContaining({ method: 'POST' }),
    ));
    // Voiding never itself calls the refund endpoint.
    expect(apiCall).not.toHaveBeenCalledWith('/api/payments/sp-1/refund', expect.anything());
  });

  it('does not warn about money when nothing is held', async () => {
    apiCall.mockResolvedValue(ok({ id: 'doc-1', status: 'voided' }));
    mount({ documentStatus: 'sent', paymentSummary: null, payments: [] });

    fireEvent.click(screen.getByRole('button', { name: /void envelope/i }));

    const dialog = await screen.findByRole('dialog', { name: /void this envelope/i });
    expect(within(dialog).queryByText(/USD/)).not.toBeInTheDocument();
  });

  it('offers no void action once the envelope is already sealed', () => {
    mount({ documentStatus: 'completed', sealed: true });
    expect(screen.queryByRole('button', { name: /void envelope/i })).not.toBeInTheDocument();
  });
});
