/**
 * Pay-then-sign, on the signer's side (PAY-1).
 *
 * The card itself is never exercised here — that lives entirely inside
 * Stripe's own iframe (see `PaymentModal.tsx`) — so `@stripe/react-stripe-js`
 * is mocked to a stand-in `PaymentElement` and a `confirmPayment` the test
 * controls directly.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import Signer from './Signer';
import PaymentModal from '@/components/sf/PaymentModal';
import type { SignerField } from '@/lib/sf/adapters';
import type { PaymentFieldConfig, PaymentIntentResponse, SignerPaymentResponse } from '@/lib/api/types';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

// `STRIPE_PUBLISHABLE_KEY` is a module-level const derived from
// `process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` at import time, so it
// cannot be reassigned directly by a test. Mocking the module with a getter
// backed by a hoisted, mutable holder lets each test simulate the browser
// having (or not having) its own copy of the key.
const stripeCheckoutState = vi.hoisted(() => ({ publishableKey: '' }));
vi.mock('@/components/sf/StripeCheckout', () => ({
  get STRIPE_PUBLISHABLE_KEY() { return stripeCheckoutState.publishableKey; },
}));

vi.mock('@/components/sf/pdf/LazyPdfPages', () => ({
  __esModule: true,
  default: ({ pages, renderOverlay }: {
    pages: number[];
    renderOverlay?: (g: { page: number; widthPt: number; heightPt: number; scale: number; widthPx: number; heightPx: number }) => React.ReactNode;
  }) => (
    <>
      {pages.map(n => (
        <div key={n} data-pdf-page={n}>
          {renderOverlay ? renderOverlay({ page: n, widthPt: 612, heightPt: 792, scale: 1, widthPx: 612, heightPx: 792 }) : null}
        </div>
      ))}
    </>
  ),
}));

// The card fields live in a Stripe-hosted iframe; the test only ever sees a
// stand-in element and a `confirmPayment` it controls, never a PAN.
const confirmPayment = vi.fn();
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <div data-testid="stripe-elements">{children}</div>,
  PaymentElement: () => <div data-testid="stripe-payment-element-stub" />,
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({}),
}));

const RECIPIENTS = [{ id: 'r1', name: 'Sarah', email: 's@example.com', role: 'sign', color: '#4f46e5', order: 1, status: 'Viewed' }];

const field = (over: Partial<SignerField> & { id: string }): SignerField => ({
  to: 'r1', type: 'payment', label: 'Deposit', page: 1,
  x: 60, y: 60, w: 220, h: 40, required: true, readOnly: false,
  placeholder: '', validation: 'none', cond: null,
  apiType: 'payment', options: [], savedValue: null, defaultValue: null,
  ...over,
} as SignerField);

const FIXED_CONFIG: PaymentFieldConfig = {
  amount_mode: 'fixed', amount_cents: 5000, min_cents: null, max_cents: null,
  currency: 'usd', memo: 'Security deposit', payment_request_id: null,
};

const SIGNER_ENTERED_CONFIG: PaymentFieldConfig = {
  amount_mode: 'signer_entered', amount_cents: null, min_cents: 1000, max_cents: 20000,
  currency: 'usd', memo: 'Pay what you owe', payment_request_id: null,
};

function mountSigner(over: Partial<React.ComponentProps<typeof Signer>> = {}) {
  cleanup();
  return render(
    <SFProvider>
      <Signer
        fields={[field({ id: 'pay1' })]}
        recipients={RECIPIENTS}
        pageCount={1}
        pdfUrl="/sign/tok/pdf"
        paymentConfigs={{ pay1: FIXED_CONFIG }}
        {...over}
      />
    </SFProvider>,
  );
}

beforeEach(() => { cleanup(); confirmPayment.mockReset(); });

describe('the payment field on the signing surface', () => {
  it('shows a Pay button with the formatted amount and the memo', () => {
    const onPay = vi.fn();
    mountSigner({ onPay });
    expect(screen.getByText('Pay $50.00')).toBeTruthy();
    expect(screen.getByText('Security deposit')).toBeTruthy();
    fireEvent.click(screen.getByText('Pay $50.00'));
    expect(onPay).toHaveBeenCalledWith('pay1');
  });

  it('blocks submit while the payment field is unpaid', () => {
    const flashes: string[] = [];
    mountSigner({ onPay: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    // Required and unpaid: the generic required-field gate catches it, same
    // as any other outstanding required field.
    expect(screen.getByText(/of 1 required fields completed/)).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
    void flashes;
  });

  it('renders a settled payment as paid, with a receipt link and no repay affordance', () => {
    const settled: SignerPaymentResponse = {
      id: 'sp1', organization_id: 'o1', document_id: 'd1', recipient_id: 'r1', field_id: 'pay1',
      payment_request_id: null, amount_cents: 5000, currency: 'usd', status: 'succeeded',
      provider: 'stripe', provider_payment_intent_id: 'pi_1', provider_charge_id: 'ch_1',
      receipt_url: 'https://stripe.example/receipts/1', failure_code: null, failure_message: null,
      paid_at: '2026-01-01T00:00:00Z', refunded_at: null, refunded_amount_cents: 0,
      description: 'Security deposit', created_at: '2026-01-01T00:00:00Z',
    };
    mountSigner({
      onPay: vi.fn(),
      paymentStatuses: { pay1: settled },
      initialValues: { pay1: 'paid:pi_1' },
    });
    expect(screen.getByText(/Paid \$50\.00/)).toBeTruthy();
    const receipt = screen.getByText('View receipt') as HTMLAnchorElement;
    expect(receipt.href).toBe('https://stripe.example/receipts/1');
    expect(screen.queryByText('Pay $50.00')).toBeNull();
    // 100% now that the payment field is satisfied.
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('renders disabled in the sender preview — no `onPay` means no real charge', () => {
    mountSigner();
    const payBtn = screen.getByText('Pay $50.00').closest('button') as HTMLButtonElement;
    expect(payBtn.disabled).toBe(true);
    expect(screen.getByText('Preview only · no charge')).toBeTruthy();
  });
});

describe('PaymentModal', () => {
  const createIntent = vi.fn();
  const refreshPayment = vi.fn();

  beforeEach(() => {
    createIntent.mockReset();
    refreshPayment.mockReset();
    stripeCheckoutState.publishableKey = '';
  });

  it('mounts with the server-provided publishable key when the intent has one', async () => {
    const { loadStripe } = await import('@stripe/stripe-js');
    (loadStripe as ReturnType<typeof vi.fn>).mockClear();
    stripeCheckoutState.publishableKey = 'pk_test_browser_copy';
    createIntent.mockResolvedValue({
      ok: true,
      data: {
        client_secret: 'pi_secret', publishable_key: 'pk_test_server_copy', connected_account_id: 'acct_1',
        amount_cents: 5000, currency: 'usd', description: 'Security deposit',
      } satisfies PaymentIntentResponse,
    });

    render(
      <PaymentModal
        fieldId="pay1"
        label="Deposit"
        config={FIXED_CONFIG}
        onClose={vi.fn()}
        onSettled={vi.fn()}
        createIntent={createIntent}
        refreshPayment={refreshPayment}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('stripe-payment-element-stub')).toBeTruthy());
    expect(loadStripe).toHaveBeenCalledWith('pk_test_server_copy', { stripeAccount: 'acct_1' });
  });

  it('falls back to the browser NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY when the server returns an empty one', async () => {
    const { loadStripe } = await import('@stripe/stripe-js');
    (loadStripe as ReturnType<typeof vi.fn>).mockClear();
    stripeCheckoutState.publishableKey = 'pk_test_browser_copy';
    createIntent.mockResolvedValue({
      ok: true,
      data: {
        client_secret: 'pi_secret', publishable_key: '', connected_account_id: 'acct_1',
        amount_cents: 5000, currency: 'usd', description: 'Security deposit',
      } satisfies PaymentIntentResponse,
    });

    render(
      <PaymentModal
        fieldId="pay1"
        label="Deposit"
        config={FIXED_CONFIG}
        onClose={vi.fn()}
        onSettled={vi.fn()}
        createIntent={createIntent}
        refreshPayment={refreshPayment}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('stripe-payment-element-stub')).toBeTruthy());
    expect(loadStripe).toHaveBeenCalledWith('pk_test_browser_copy', { stripeAccount: 'acct_1' });
  });

  it('shows the unavailable state naming both env vars only when neither key exists', async () => {
    stripeCheckoutState.publishableKey = '';
    createIntent.mockResolvedValue({
      ok: true,
      data: {
        client_secret: 'pi_secret', publishable_key: '', connected_account_id: 'acct_1',
        amount_cents: 5000, currency: 'usd', description: 'Security deposit',
      } satisfies PaymentIntentResponse,
    });

    render(
      <PaymentModal
        fieldId="pay1"
        label="Deposit"
        config={FIXED_CONFIG}
        onClose={vi.fn()}
        onSettled={vi.fn()}
        createIntent={createIntent}
        refreshPayment={refreshPayment}
      />,
    );
    await waitFor(() => expect(screen.getByText(/neither the server/)).toBeTruthy());
    expect(screen.getByText('STRIPE_PUBLISHABLE_KEY')).toBeTruthy();
    expect(screen.getByText('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')).toBeTruthy();
  });

  it('validates a signer-entered amount against min/max before requesting an intent', async () => {
    render(
      <PaymentModal
        fieldId="pay1"
        label="Deposit"
        config={SIGNER_ENTERED_CONFIG}
        onClose={vi.fn()}
        onSettled={vi.fn()}
        createIntent={createIntent}
        refreshPayment={refreshPayment}
      />,
    );
    const input = screen.getByLabelText('Amount to pay') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1.00' } });
    expect(screen.getByText('Minimum is $10.00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();

    fireEvent.change(input, { target: { value: '500.00' } });
    expect(screen.getByText('Maximum is $200.00')).toBeTruthy();

    fireEvent.change(input, { target: { value: '25.00' } });
    expect(screen.queryByText(/Minimum is/)).toBeNull();
    expect(screen.queryByText(/Maximum is/)).toBeNull();

    createIntent.mockResolvedValue({
      ok: true,
      data: {
        client_secret: 'pi_secret', publishable_key: 'pk_test_1', connected_account_id: 'acct_1',
        amount_cents: 2500, currency: 'usd', description: 'Pay what you owe',
      } satisfies PaymentIntentResponse,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(createIntent).toHaveBeenCalledWith('pay1', 2500));
  });

  it('shows a bounded "confirming" state rather than a false failure while a webhook is late', async () => {
    createIntent.mockResolvedValue({
      ok: true,
      data: {
        client_secret: 'pi_secret', publishable_key: 'pk_test_1', connected_account_id: 'acct_1',
        amount_cents: 5000, currency: 'usd', description: 'Security deposit',
      } satisfies PaymentIntentResponse,
    });
    // Stripe confirms the charge to the browser before our own record updates.
    confirmPayment.mockResolvedValue({ paymentIntent: { status: 'processing' } });

    render(
      <PaymentModal
        fieldId="pay1"
        label="Deposit"
        config={FIXED_CONFIG}
        onClose={vi.fn()}
        onSettled={vi.fn()}
        createIntent={createIntent}
        refreshPayment={refreshPayment}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('stripe-payment-element-stub')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Pay \$50\.00/ }));
    await waitFor(() => expect(screen.getByText('Confirming your payment…')).toBeTruthy());
  });

  it('surfaces a declined card as an actionable, retryable message', async () => {
    createIntent.mockResolvedValue({
      ok: true,
      data: {
        client_secret: 'pi_secret', publishable_key: 'pk_test_1', connected_account_id: 'acct_1',
        amount_cents: 5000, currency: 'usd', description: 'Security deposit',
      } satisfies PaymentIntentResponse,
    });
    confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });

    render(
      <PaymentModal
        fieldId="pay1"
        label="Deposit"
        config={FIXED_CONFIG}
        onClose={vi.fn()}
        onSettled={vi.fn()}
        createIntent={createIntent}
        refreshPayment={refreshPayment}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('stripe-payment-element-stub')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Pay \$50\.00/ }));
    await waitFor(() => expect(screen.getByText('Your card was declined.')).toBeTruthy());
    // Retryable: the "Try again" affordance is offered, not a dead end.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

/**
 * `SignSurface` wires `Signer` to the token endpoints. Mocked here so a 402
 * from `complete` — `signer_payment_service.assert_payments_settled` naming
 * the unpaid field — can be asserted end to end, without a network.
 */
const completeSigning = vi.fn();
vi.mock('@/app/sign/[token]/actions', () => ({
  markViewed: vi.fn().mockResolvedValue({ ok: true, message: 'Envelope opened' }),
  completeSigning: (...args: unknown[]) => completeSigning(...args),
  declineSigning: vi.fn(),
  reassignSigning: vi.fn(),
  saveFieldValue: vi.fn().mockResolvedValue({ ok: true, message: 'Saved' }),
  saveSignature: vi.fn(),
  uploadAttachment: vi.fn(),
  createPaymentIntent: vi.fn(),
  refreshPayment: vi.fn(),
  getPayment: vi.fn().mockResolvedValue({ ok: true, data: null }),
  getPaymentFieldConfig: vi.fn().mockResolvedValue({ ok: true, data: FIXED_CONFIG }),
}));

describe('completing signing with an unpaid field', () => {
  it('surfaces the 402 from `complete` verbatim, naming the unpaid field', async () => {
    completeSigning.mockReset();
    completeSigning.mockResolvedValue({
      ok: false,
      message: 'Payment required before signing: Deposit',
    });
    const { default: SignSurface } = await import('@/app/sign/[token]/SignSurface');
    render(
      <SFProvider>
        <SignSurface
          token="tok1"
          fields={[field({ id: 'pay1' })]}
          recipients={RECIPIENTS}
          // Seeded as already "paid" client-side (e.g. a stale reload) so the
          // generic required-field gate passes and `complete` is actually
          // called — the case that exercises the backend's own 402 gate
          // (`signer_payment_service.assert_payments_settled`), which is the
          // authority `Field.value` alone is not (see that service's docstring).
          initialValues={{ pay1: 'paid:pi_stale' }}
          pageCount={1}
          readOnly={false}
          canDecline
          canReassign
          signerName="Sarah"
          documentTitle="Lease"
          pdfHref="/sign/tok1/pdf"
          consentVersion="1.0"
          otherPlacements={[]}
        />
      </SFProvider>,
    );
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish' })); });
    await waitFor(() => expect(completeSigning).toHaveBeenCalledWith('tok1'));
    // The exact backend detail, not a generic "Could not save" — it names
    // the field that still blocks the signer.
    await waitFor(() => expect(screen.getByText('Payment required before signing: Deposit')).toBeTruthy());
  });
});
