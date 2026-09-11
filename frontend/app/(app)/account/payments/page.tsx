/**
 * Payments settings — server-rendered with the caller's own Stripe Connect
 * account (if any) so the first paint already knows whether it can collect
 * money, rather than showing a spinner for a fact the server already has.
 */
import type { Metadata } from 'next';
import Payments from '@/components/sf/screens/Payments';
import { serverCaller } from '@/lib/api/client';
import { payments as paymentsApi } from '@/lib/api/resources';

export const metadata: Metadata = { title: 'Payments · Account · SignerPro' };

export default async function Page() {
  const api = serverCaller('/account/payments');
  const result = await paymentsApi.account(api);

  return (
    <Payments
      account={result.ok ? result.data : null}
      loadError={result.ok ? null : result.error.message}
    />
  );
}
