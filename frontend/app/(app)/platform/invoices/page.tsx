import type { Metadata } from 'next';
import Invoices from '@/components/sf/screens/Invoices';
import { serverCaller } from '@/lib/api/client';
import { toInvoiceRows } from '@/lib/sf/adapters';
import type { PlatformInvoiceResponse } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Invoices · SignerPro Platform' };

/** The design's four chips; anything else in the URL falls back to `all`. */
const FILTERS = ['all', 'open', 'paid', 'past_due'];

export default async function Page(
  { searchParams }: { searchParams: Promise<{ status?: string; organization_id?: string }> },
) {
  const { status, organization_id } = await searchParams;
  const filter = status && FILTERS.indexOf(status) > -1 ? status : 'all';
  const api = serverCaller('/platform/invoices');

  /* `organization_id` is not on `platformInvoices.list`'s param type, so the
     caller is used directly rather than editing the shared resource module. */
  const listResult = await api<PlatformInvoiceResponse[]>('/api/saas/invoices', {
    query: { status: filter === 'all' ? undefined : filter, organization_id },
  });

  return (
    <>
      {!listResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Platform invoices" detail={(listResult.ok ? null : listResult.error.message)} />
        </div>
      ) : null}
      <Invoices
        rows={toInvoiceRows(listResult.ok ? listResult.data : [])}
        filter={filter}
        platform
        scopeName="All tenants"
      />
    </>
  );
}
