/**
 * One tenant's record — `/platform/tenants/{id}`.
 *
 * Backed by a single call, `GET /api/saas/tenants/{id}/profile`, which returns
 * the tenant row plus its members, envelopes, API keys, webhooks, invoices,
 * charges and signer payments. Doing it in one request is deliberate: the
 * console used to answer these questions by impersonating the tenant, and a
 * read-only question should never cost a privileged, audited session.
 *
 * The open section is `?tab=` so a link can land on it.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import TenantRecord from '@/components/sf/screens/TenantRecord';
import { tenantRecordTab } from '@/lib/sf/tenantRecord';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import { serverCaller } from '@/lib/api/client';
import { flags as flagsApi, tenants as tenantsApi } from '@/lib/api/resources';

export const metadata: Metadata = { title: 'Tenant record · SignerPro Platform' };

type SearchParams = { [key: string]: string | string[] | undefined };

export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const requested = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = tenantRecordTab(requested);

  const api = serverCaller('/platform/tenants/' + id);
  /* The flag catalogue comes along so the override control can say what each
     flag resolves to *without* an override; a failed call means the section
     renders no rows rather than offering "Inherit (off)" as a fact. */
  const [result, flagsResult] = await Promise.all([
    tenantsApi.profile(api, id),
    flagsApi.list(api),
  ]);

  /* A tenant that does not exist is a 404, not an empty record page: rendering
     a blank profile would claim the account exists and has nothing in it. */
  if (!result.ok && result.error.status === 404) notFound();

  if (!result.ok) {
    return (
      <div style={{ padding: '22px' }}>
        <ApiUnavailable what="This tenant's record" detail={result.error.message} />
      </div>
    );
  }

  const flags = flagsResult.ok ? flagsResult.data.map(f => ({ key: f.key, on: f.enabled })) : [];

  return <TenantRecord profile={result.data} tab={tab} flags={flags} />;
}
