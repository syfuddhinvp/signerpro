import type { Metadata } from 'next';
import Catalog from '@/components/sf/screens/Catalog';
import { serverCaller } from '@/lib/api/client';
import { platformCatalog as catalogApi } from '@/lib/api/resources';

export const metadata: Metadata = { title: 'Form catalog · SignerPro Platform' };

export default async function Page() {
  const api = serverCaller('/platform/catalog');
  // Drafts included: an entry with no PDF yet is the one a curator most needs
  // to see, and it is invisible to tenants until it is published.
  const result = await catalogApi.list(api, { include_unpublished: true, limit: 200 });

  return (
    <Catalog
      items={result.ok ? result.data.items : []}
      /* An empty catalog and an unreachable API produce the same prop; the
         error is passed through so the screen can say which of the two. */
      loadError={result.ok ? null : result.error.message}
    />
  );
}
