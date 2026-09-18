'use client';

/**
 * The signer's payment ceremony for one `payment` field (PAY-1).
 *
 * The rule this file exists to protect (see `StripeCheckout.tsx`): a card
 * number is never in this document's DOM, never in React state, never in a
 * request to our API. Stripe's Payment Element — a Stripe-hosted iframe —
 * is the only thing that ever sees it.
 *
 * The PaymentIntent this mounts against lives on the TENANT's connected
 * Stripe account, not the platform's. `loadStripe` is therefore called with
 * `{ stripeAccount: connected_account_id }` — omitting it would mount
 * Elements against the platform account, which cannot see (let alone
 * confirm) an intent that was created as a direct charge on the connected
 * account (`signer_payment_service.create_intent`).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { loadStripe, type Stripe, type StripeError } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useModalBehaviour } from './useModalBehaviour';
import { btn, inputStyle, TEXT_MUTED } from '@/lib/sf/ui';
import type { PaymentFieldConfig, PaymentIntentResponse, SignerPaymentResponse } from '@/lib/api/types';
import Icon from '@/components/sf/Icon';
import { STRIPE_PUBLISHABLE_KEY } from '@/components/sf/StripeCheckout';

export type PaymentActionOutcome<T> = { ok: true; data: T } | { ok: false; message: string };

export type PaymentModalProps = {
  fieldId: string;
  /** The field's own label, so the dialog can be announced by name. */
  label: string;
  /** `null` while the config has not loaded yet (or failed to). */
  config: PaymentFieldConfig | null;
  onClose: () => void;
  /** Called once with the settled (`succeeded`) payment. */
  onSettled: (payment: SignerPaymentResponse) => void;
  createIntent: (fieldId: string, amountCents?: number) => Promise<PaymentActionOutcome<PaymentIntentResponse>>;
  refreshPayment: (fieldId: string) => Promise<PaymentActionOutcome<SignerPaymentResponse>>;
};

/**
 * `loadStripe` injects a script tag and opens a connection, so it is memoised
 * per (publishable key, connected account) pair for the tab's lifetime rather
 * than re-created on every modal open — the same discipline `StripeCheckout.tsx`
 * uses for the platform-account case.
 */
const stripeCache = new Map<string, Promise<Stripe | null>>();
function stripeForAccount(publishableKey: string, connectedAccountId: string): Promise<Stripe | null> {
  const cacheKey = `${publishableKey}::${connectedAccountId}`;
  let promise = stripeCache.get(cacheKey);
  if (!promise) {
    promise = loadStripe(publishableKey, { stripeAccount: connectedAccountId });
    stripeCache.set(cacheKey, promise);
  }
  return promise;
}

/**
 * How long this waits for a webhook before falling back to its own
 * reconciliation. Stripe confirms the charge to the browser immediately;
 * our own record of it only updates once `payment_intent.succeeded` lands
 * (or `refresh_payment` is called). In development nothing points a live
 * Stripe endpoint back at a local machine, so the webhook may never arrive
 * at all — a bounded poll with backoff closes that gap without leaving the
 * signer staring at a spinner forever, and without falsely reporting failure
 * for money that in fact went through.
 */
const POLL_DELAYS_MS = [1000, 1500, 2500, 4000, 6000, 8000];

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 85, background: 'rgba(15,23,42,.55)',
  display: 'grid', placeItems: 'center', padding: '24px',
};
const card: CSSProperties = {
  width: '480px', maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', background: '#fff',
  border: '1px solid #e3e7ee', borderRadius: '16px', boxShadow: '0 30px 70px -30px rgba(15,23,42,.5)',
};
const cardHead: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px',
  padding: '16px 18px', borderBottom: '1px solid #eef1f6',
};
const cardBody: CSSProperties = { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' };
const iconBtn: CSSProperties = {
  width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee',
  background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: '.75rem',
};
const noticeStyle = {
  fontSize: '.78125rem', lineHeight: 1.6, color: '#7c2d12', background: '#fff7ed',
  border: '1px solid #fed7aa', borderRadius: '10px', padding: '12px 13px',
} as const;

export default function PaymentModal({
  fieldId, label, config, onClose, onSettled, createIntent, refreshPayment,
}: PaymentModalProps) {
  const closeModal = useCallback(() => onClose(), [onClose]);
  const dialogRef = useModalBehaviour<HTMLDivElement>(true, closeModal);

  const signerEntered = config?.amount_mode === 'signer_entered';
  const currency = config?.currency ?? 'usd';
  const lowerBoundCents = config?.min_cents ?? 50;
  const upperBoundCents = config?.max_cents ?? null;

  const [amountDollars, setAmountDollars] = useState(() => {
    const seed = config?.amount_cents ?? lowerBoundCents;
    return (seed / 100).toFixed(2);
  });
  const amountError = useMemo(() => {
    if (!signerEntered) return null;
    const cents = Math.round(Number(amountDollars) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return 'Enter an amount';
    if (cents < lowerBoundCents) return `Minimum is ${formatCents(lowerBoundCents, currency)}`;
    if (upperBoundCents !== null && cents > upperBoundCents) return `Maximum is ${formatCents(upperBoundCents, currency)}`;
    return null;
  }, [amountDollars, signerEntered, lowerBoundCents, upperBoundCents, currency]);

  const [phase, setPhase] = useState<'amount' | 'creating' | 'card' | 'polling' | 'error'>(
    signerEntered ? 'amount' : 'creating',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);
  /**
   * Guards the poll against running on after the signer closes the modal.
   *
   * The flag is re-armed on *mount*, not just latched on unmount: React's
   * StrictMode (`reactStrictMode: true` in `next.config.ts`) mounts, unmounts
   * and remounts every effect in development, so a cleanup-only ref is set to
   * `true` before the signer has even seen the card form — and nothing ever
   * clears it. `pollForSettlement` would then bail on its first tick, leaving
   * "Confirming your payment…" spinning forever on a charge Stripe had
   * already taken, without ever calling `refresh_payment`.
   */
  const pollCancelled = useRef(false);
  useEffect(() => {
    pollCancelled.current = false;
    return () => { pollCancelled.current = true; };
  }, []);

  const startIntent = useCallback(async () => {
    setErrorMessage(null);
    setPhase('creating');
    const proposedCents = signerEntered ? Math.round(Number(amountDollars) * 100) : undefined;
    const result = await createIntent(fieldId, proposedCents);
    if (!result.ok) {
      setErrorMessage(result.message);
      setPhase('error');
      return;
    }
    setIntent(result.data);
    setPhase('card');
  }, [createIntent, fieldId, signerEntered, amountDollars]);

  // A fixed-amount field has nothing to ask the signer — go straight to Stripe.
  useEffect(() => {
    if (!signerEntered && phase === 'creating' && !intent && !errorMessage) void startIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollForSettlement = useCallback(async () => {
    setPhase('polling');
    for (const delay of POLL_DELAYS_MS) {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (pollCancelled.current) return;
      // A server action can *reject* (a dropped connection, a redeploy mid-poll)
      // rather than return `{ ok: false }`. Left uncaught that escapes the
      // `void pollForSettlement()` call site as an unhandled rejection and the
      // spinner never resolves, so a throw is treated like any other
      // unsuccessful tick: retry on the next delay.
      let result: PaymentActionOutcome<SignerPaymentResponse>;
      try {
        result = await refreshPayment(fieldId);
      } catch {
        continue;
      }
      if (pollCancelled.current) return;
      if (!result.ok) continue;
      if (result.data.status === 'succeeded') { onSettled(result.data); return; }
      if (result.data.status === 'failed') {
        setErrorMessage(result.data.failure_message || 'The payment was declined.');
        setPhase('error');
        return;
      }
    }
    // Bounded: still not settled after ~23s. Retryable rather than an
    // indefinite spinner or a false "it failed".
    setErrorMessage('Still confirming your payment with the bank — this can take a little longer. Check again in a moment.');
    setPhase('error');
  }, [fieldId, onSettled, refreshPayment]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Pay — ${label}`} ref={dialogRef} data-sf-modal-open="" tabIndex={-1} style={overlay}>
      <div style={card}>
        <div style={cardHead}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>Pay — {label}</span>
            <span style={{ fontSize: '.75rem', color: TEXT_MUTED }}>
              {config?.memo || 'Paid directly to the sender · processed by Stripe'}
            </span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={iconBtn}><Icon name="close" size={13} /></button>
        </div>
        <div style={cardBody}>
          {phase === 'amount' ? (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '.78125rem', color: '#334155' }}>
                Amount ({currency.toUpperCase()})
                <input
                  type="number"
                  step="0.01"
                  min={(lowerBoundCents / 100).toFixed(2)}
                  max={upperBoundCents !== null ? (upperBoundCents / 100).toFixed(2) : undefined}
                  value={amountDollars}
                  onChange={e => setAmountDollars(e.target.value)}
                  aria-label="Amount to pay"
                  aria-invalid={amountError ? true : undefined}
                  aria-describedby={amountError ? 'payment-amount-problem' : undefined}
                  style={inputStyle}
                />
              </label>
              {amountError ? (
                <span id="payment-amount-problem" role="alert" style={{ fontSize: '.71875rem', color: '#b91c1c' }}>{amountError}</span>
              ) : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={onClose} style={btn('#fff', '#475569', '#e3e7ee')}><Icon name="close" size={13} />Cancel</button>
                <button type="button" disabled={!!amountError} onClick={() => void startIntent()} style={btn('#4f46e5', '#fff', '#4f46e5')}>
                  <Icon name="arrowRight" size={13} />Continue to payment
                </button>
              </div>
            </>
          ) : null}

          {phase === 'creating' ? (
            <div style={{ padding: '28px 0', textAlign: 'center', fontSize: '.78125rem', color: TEXT_MUTED }}>
              Opening a secure payment session…
            </div>
          ) : null}

          {phase === 'card' && intent ? (
            <PaymentElementPanel
              intent={intent}
              onCancel={onClose}
              onConfirmError={message => { setErrorMessage(message); setPhase('error'); }}
              onConfirmed={() => void pollForSettlement()}
            />
          ) : null}

          {phase === 'polling' ? (
            <div role="status" style={{ padding: '20px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
              <span aria-hidden="true" style={{ width: '22px', height: '22px', border: '3px solid #e3e7ee', borderTopColor: '#4f46e5', borderRadius: '999px', animation: 'sfSpin .8s linear infinite' }} />
              <span style={{ fontSize: '.8125rem', fontWeight: 600, color: '#0f172a' }}>Confirming your payment…</span>
              <span style={{ fontSize: '.71875rem', color: TEXT_MUTED }}>Stripe has your card — we are just waiting on confirmation.</span>
            </div>
          ) : null}

          {phase === 'error' ? (
            <>
              <div role="alert" style={noticeStyle}>{errorMessage || 'The payment could not be completed.'}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={onClose} style={btn('#fff', '#475569', '#e3e7ee')}><Icon name="close" size={13} />Close</button>
                <button
                  type="button"
                  onClick={() => { setErrorMessage(null); setIntent(null); void startIntent(); }}
                  style={btn('#4f46e5', '#fff', '#4f46e5')}
                >
                  <Icon name="refresh" size={13} />Try again
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Mounted only once the intent exists. `Elements` is keyed by `clientSecret`
 * so a retried intent (a fresh `client_secret`) gets a fresh mount rather than
 * Stripe.js reusing a stale one.
 */
function PaymentElementPanel({
  intent, onConfirmed, onConfirmError, onCancel,
}: {
  intent: PaymentIntentResponse;
  onConfirmed: () => void;
  onConfirmError: (message: string) => void;
  onCancel: () => void;
}) {
  // The server's copy is preferred, but it may have shipped an empty string
  // if `STRIPE_PUBLISHABLE_KEY` is unset there — the server cannot know
  // whether this browser already holds the same platform key under
  // `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, so it defers to us. Both hold the
  // same value; only fall through to "unavailable" if neither is set.
  const publishableKey = intent.publishable_key || STRIPE_PUBLISHABLE_KEY;
  const stripePromise = useMemo(
    () => stripeForAccount(publishableKey, intent.connected_account_id),
    [publishableKey, intent.connected_account_id],
  );

  if (!publishableKey || !intent.connected_account_id) {
    if (!publishableKey) {
      return (
        <div role="status" style={noticeStyle}>
          Payments are not available: neither the server&apos;s <code>STRIPE_PUBLISHABLE_KEY</code> nor
          this browser&apos;s <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> is configured — they hold
          the same platform publishable key, and at least one must be set.
        </div>
      );
    }
    return (
      <div role="status" style={noticeStyle}>
        Payments are not available: the tenant has not finished connecting Stripe.
      </div>
    );
  }

  return (
    <Elements key={intent.client_secret} stripe={stripePromise} options={{ clientSecret: intent.client_secret }}>
      <PaymentForm intent={intent} onConfirmed={onConfirmed} onConfirmError={onConfirmError} onCancel={onCancel} />
    </Elements>
  );
}

function PaymentForm({
  intent, onConfirmed, onConfirmError, onCancel,
}: {
  intent: PaymentIntentResponse;
  onConfirmed: () => void;
  onConfirmError: (message: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setLocalError(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (error) {
      // A card decline is `card_error`/`validation_error` with a message meant
      // for the cardholder; anything else gets an honest fallback. Either way
      // the form stays mounted so the signer can simply try another card.
      const stripeError = error as StripeError;
      onConfirmError(stripeError.message || 'The card was declined. Try another payment method.');
      return;
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onConfirmed();
      return;
    }
    onConfirmError('The payment did not complete. Try again.');
  };

  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ fontSize: '.8125rem', fontWeight: 600 }}>{formatCents(intent.amount_cents, intent.currency)}</div>
      <div data-testid="stripe-payment-element">
        <PaymentElement />
      </div>
      {localError ? <div role="alert" style={noticeStyle}>{localError}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button type="button" onClick={onCancel} style={btn('#fff', '#475569', '#e3e7ee')}><Icon name="close" size={13} />Cancel</button>
        <button type="submit" disabled={!stripe || submitting} style={btn('#4f46e5', '#fff', '#4f46e5')}>
          <Icon name="card" size={13} />{submitting ? 'Processing…' : `Pay ${formatCents(intent.amount_cents, intent.currency)}`}
        </button>
      </div>
    </form>
  );
}
