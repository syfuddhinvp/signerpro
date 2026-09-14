/**
 * Branding themes — server-rendered with the tenant's themes already loaded,
 * so the first paint shows the brand rather than a spinner in front of it.
 *
 * The subscription is fetched alongside them because `custom_branding` is a
 * paid entitlement and only the *writes* enforce it: listing themes succeeds on
 * every plan. Without this the screen looked fully available and answered the
 * first save with a 402, which is the worst moment to learn that the feature
 * was never included.
 */
import type { Metadata } from 'next';
import Brand from '@/components/sf/screens/Brand';
import { serverCaller } from '@/lib/api/client';
import { billing as billingApi, brandingThemes as brandingApi } from '@/lib/api/resources';

export const metadata: Metadata = { title: 'Branding themes · Account · SignerPro' };

export default async function Page() {
  const api = serverCaller('/account/brand');
  const [themesResult, subscriptionResult] = await Promise.all([
    brandingApi.list(api),
    billingApi.subscription(api),
  ]);

  /* The API stays the authority: if the subscription could not be read, the
     screen assumes the feature is available rather than locking a paying
     tenant out of it, and a write that turns out not to be entitled surfaces
     the backend's own explanation. */
  const entitled = subscriptionResult.ok
    ? subscriptionResult.data.entitlements.custom_branding !== false
    : true;

  return (
    <Brand
      themes={themesResult.ok ? themesResult.data : []}
      loadError={themesResult.ok ? null : themesResult.error.message}
      entitled={entitled}
      planName={subscriptionResult.ok ? subscriptionResult.data.plan_name : null}
    />
  );
}
