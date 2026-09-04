import type { Metadata } from 'next';
import Invoices from '@/components/sf/screens/Invoices';
import { serverCaller } from '@/lib/api/client';
import { organizations as organizationsApi } from '@/lib/api/resources';
import { toInvoiceRows } from '@/lib/sf/adapters';
import type { InvoiceResponse } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Invoices · Account · SignForge' };

/** The design's four chips; anything else in the URL falls back to `all`. */
const FILTERS = ['all', 'open', 'paid', 'past_due'];

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter = status && FILTERS.indexOf(status) > -1 ? status : 'all';
  const api = serverCaller('/account/invoices');

  /* `scope` is not on `invoices.list`'s param type, so the caller is used
     directly rather than editing the shared resource module. */
  const [listResult, orgResult] = await Promise.all([
    api<InvoiceResponse[]>('/api/invoices', {
      query: { status: filter === 'all' ? undefined : filter, scope: 'organization' },
    }),
    organizationsApi.me(api),
  ]);

  const rows = toInvoiceRows(listResult.ok ? listResult.data : []);

  return (
    <>
      {!listResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Your invoices" detail={(listResult.ok ? null : listResult.error.message)} />
        </div>
      ) : null}
      <Invoices
        rows={rows}
        filter={filter}
        platform={false}
        scopeName={orgResult.ok ? orgResult.data.name : 'Your workspace'}
      />
    </>
  );
}
