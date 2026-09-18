/**
 * Payments — server-rendered with the caller's own Stripe Connect account (if
 * any) so the first paint already knows whether it can collect money, rather
 * than showing a spinner for a fact the server already has.
 *
 * Two panels, because "can I take money" and "what money have I taken" are
 * the two questions a tenant brings here. The ledger (PAY-2) is the second:
 * before it, payments were only visible from inside one envelope's audit page
 * and refunds only reachable there, so a tenant collecting across many
 * envelopes had nowhere to review, reconcile or return any of it.
 */
import type { Metadata } from 'next';
import Payments from '@/components/sf/screens/Payments';
import PaymentsLedger from '@/components/sf/screens/PaymentsLedger';
import { serverCaller } from '@/lib/api/client';
import { payments as paymentsApi } from '@/lib/api/resources';
import type { SignerPaymentStatus } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Payments · Account · SignerPro' };

const LEDGER_FILTERS: ReadonlySet<string> = new Set([
  'succeeded', 'refunded', 'failed', 'processing', 'requires_payment',
]);

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const api = serverCaller('/account/payments');
  const params = (await searchParams) ?? {};
  /* Only a status the API actually accepts is forwarded; anything else is
     treated as "all" rather than passed through to 422 the request. */
  const filter = params.status && LEDGER_FILTERS.has(params.status)
    ? (params.status as SignerPaymentStatus)
    : undefined;

  const [accountResult, ledgerResult] = await Promise.all([
    paymentsApi.account(api),
    paymentsApi.ledger(api, { status: filter, limit: 50 }),
  ]);

  return (
    <>
      <Payments
        account={accountResult.ok ? accountResult.data : null}
        loadError={accountResult.ok ? null : accountResult.error.message}
      />
      <PaymentsLedger
        page={ledgerResult.ok ? ledgerResult.data : null}
        loadError={ledgerResult.ok ? null : ledgerResult.error.message}
        filter={filter ?? 'all'}
      />
    </>
  );
}
