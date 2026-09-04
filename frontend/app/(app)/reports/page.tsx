/**
 * Reports (RPT-1…8) in tenant scope.
 *
 * The range picker is the `?range=` search param, not client state, so a range
 * is shareable and every change re-runs this component server-side. All the
 * fetching lives in `./load.ts`, which the platform route reuses.
 */

import type { Metadata } from 'next';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import Reports from '@/components/sf/screens/Reports';
import { loadReportsProps, type ReportsSearchParams } from './load';

export const metadata: Metadata = { title: 'Reports · SignForge' };

export default async function Page({ searchParams }: { searchParams: Promise<ReportsSearchParams> }) {
  const { apiUnavailable, ...props } = await loadReportsProps('/reports', 'tenant', await searchParams);
  return (
    <>
      {apiUnavailable ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Your reports" detail={apiUnavailable} />
        </div>
      ) : null}
      <Reports {...props} />
    </>
  );
}
