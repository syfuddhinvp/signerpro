'use client';

/**
 * Stripe's Embedded Checkout, mounted inside our own modal.
 *
 * The application used to render "Card number / Expiry / CVC" inputs of its
 * own (AUDIT_REPORT.md §7 finding 3). Everything below exists so that it does
 * not: the fields live in a Stripe-hosted iframe on Stripe's origin, so a PAN
 * is never in this document's DOM, never in React state, and never in a
 * request to our API. What crosses our boundary is a session id.
 *
 * The publishable key is `NEXT_PUBLIC_*` on purpose — it is designed to be
 * shipped to browsers and can only create tokens, not read or charge. The
 * secret key must never appear here.
 */

import React, { useMemo } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';
import { TEXT_MUTED } from '@/lib/sf/ui';

export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** True when a publishable key is configured at all. */
export function stripeIsConfigured(): boolean {
  return STRIPE_PUBLISHABLE_KEY.trim().length > 0;
}

/**
 * `loadStripe` injects a script tag, so it is called once per key for the
 * lifetime of the tab rather than on every modal open.
 */
let stripeSingleton: Promise<Stripe | null> | null = null;
function stripePromise(): Promise<Stripe | null> {
  if (!stripeSingleton) stripeSingleton = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripeSingleton;
}

const noticeStyle = {
  fontSize: '.78125rem',
  lineHeight: 1.6,
  color: 'hsl(var(--color-fg-warning))',
  background: 'hsl(var(--color-bg-warning-subtle))',
  border: '1px solid hsl(var(--color-border-warning))',
  borderRadius: '10px',
  padding: '12px 13px',
} as const;

/** An honest message beats a blank iframe the user waits on forever. */
export function StripeUnavailable({ reason }: { reason: string }) {
  return (
    <div role="status" style={noticeStyle}>
      <strong style={{ display: 'block', marginBottom: '4px' }}>Payments are not available</strong>
      {reason}
    </div>
  );
}

export type StripeCheckoutPanelProps = {
  /** From POST /api/billing/checkout or /setup-session. Null while loading. */
  clientSecret: string | null;
  /** An error already surfaced by the caller's API call, if any. */
  error?: string | null;
  /** False for a test-mode session; the badge says so out loud. */
  livemode?: boolean;
};

/**
 * The iframe and nothing else. The session is created by the caller, because
 * only the caller knows whether this is a plan purchase or a card save.
 */
export default function StripeCheckoutPanel({ clientSecret, error, livemode }: StripeCheckoutPanelProps) {
  const options = useMemo(() => ({ clientSecret: clientSecret ?? '' }), [clientSecret]);

  if (!stripeIsConfigured()) {
    return (
      <StripeUnavailable reason="NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set, so the payment form cannot load. Set it in frontend/.env.local (it is the pk_test_… key from the Stripe dashboard) and restart the dev server." />
    );
  }
  if (error) return <StripeUnavailable reason={error} />;
  if (!clientSecret) {
    return (
      <div style={{ padding: '28px 0', textAlign: 'center', fontSize: '.78125rem', color: TEXT_MUTED }}>
        Opening a secure payment session…
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {livemode === false ? (
        <span
          style={{
            alignSelf: 'flex-start', padding: '3px 8px', borderRadius: '999px',
            border: '1px solid hsl(var(--color-border-warning))', background: 'hsl(var(--color-bg-warning-subtle))', color: 'hsl(var(--color-fg-warning))',
            fontSize: '.65625rem', fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase',
          }}
        >
          Stripe test mode · no real money moves
        </span>
      ) : null}
      {/*
        The iframe is focusable but its contents are not reachable by our own
        focus trap (cross-origin), which is correct: once focus enters the
        frame Stripe manages it, and Tab returns to our trap on the way out.
      */}
      <div data-testid="stripe-embedded-checkout" style={{ minHeight: '320px' }}>
        <StripeMountBoundary key={clientSecret}>
          <EmbeddedCheckoutProvider stripe={stripePromise()} options={options}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </StripeMountBoundary>
      </div>
    </div>
  );
}

/**
 * Stripe.js throws on an expired or malformed client secret, and an unhandled
 * throw inside a modal takes the whole page down. The user is told what
 * happened instead.
 */
class StripeMountBoundary extends React.Component<
  { children: React.ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : 'Stripe could not load the payment form.' };
  }

  render() {
    if (this.state.message) return <StripeUnavailable reason={this.state.message} />;
    return this.props.children;
  }
}
