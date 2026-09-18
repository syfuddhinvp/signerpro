/**
 * `/account/integrations/callback` — where a cloud storage provider returns
 * the browser after the sender has approved (or refused) the grant. The
 * backend's `CLOUD_OAUTH_REDIRECT_URL` points here.
 *
 * The work is client-side because the authorization code has to be posted
 * from the session that started the grant, so this file is only the route:
 * metadata, and the Suspense boundary `useSearchParams` requires.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import IntegrationsCallback from '@/components/sf/IntegrationsCallback';
import ScreenSkeleton from '@/app/_fallbacks/ScreenSkeleton';

export const metadata: Metadata = { title: 'Connecting · Integrations · SignerPro' };

export default function Page() {
  return (
    <Suspense fallback={<ScreenSkeleton label="Finishing the connection" shape="form" />}>
      <IntegrationsCallback />
    </Suspense>
  );
}
