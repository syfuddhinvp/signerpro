'use client';

/**
 * Handles the landing after Stripe redirects the browser back from an
 * embedded Checkout session.
 *
 * The redirect itself is worth nothing as evidence — anyone can type
 * `?session_id=…` into the address bar, and Stripe's own docs are explicit
 * that the return url is not a confirmation. So this component asks our
 * backend, which asks Stripe with the secret key, and reports whatever comes
 * back: `complete` is a success, anything else is said out loud as "not
 * finished" rather than rounded up.
 *
 * The parameter is then stripped from the url so a reload does not re-report
 * a payment that happened once.
 */

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { apiCall } from '@/lib/api/browser';
import { billing as billingApi } from '@/lib/api/resources';

export default function CheckoutReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const { flash } = useSF();
  const sessionId = params.get('session_id');
  /* React 18 mounts effects twice in development; confirming twice would
     double the toast (the backend itself is idempotent). */
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || handled.current === sessionId) return;
    handled.current = sessionId;

    void billingApi.confirmCheckout(apiCall, sessionId).then(res => {
      if (!res.ok) {
        flash('Could not confirm that payment session · ' + res.error.message);
      } else if (res.data.applied && res.data.mode === 'setup') {
        flash('Payment method saved · confirmed with Stripe');
      } else if (res.data.applied) {
        flash('Payment confirmed with Stripe · your plan is up to date');
      } else {
        flash('That payment session is ' + res.data.status + ' · nothing has been charged');
      }
      router.refresh();
    });

    // Strip the parameter without adding a history entry.
    const url = new URL(window.location.href);
    url.searchParams.delete('session_id');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [sessionId, flash, router]);

  return null;
}
