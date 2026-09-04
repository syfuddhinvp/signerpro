/**
 * Reports in platform scope.
 *
 * The same screen as `app/(app)/reports/page.tsx`, loaded by the same function.
 * The reports API has no platform scope to request — `backend/app/api/routes/
 * reports.py` derives the organization from `get_current_user` and exposes no
 * tenant or "all tenants" parameter — so this variant labels what it is showing
 * instead of presenting one tenant's numbers as the platform's. Platform-wide
 * aggregates live on `/api/saas/*` (the Platform overview screen).
 */

import type { Metadata } from 'next';
import Reports from '@/components/sf/screens/Reports';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import { loadReportsProps, type ReportsSearchParams } from '../../reports/load';

export const metadata: Metadata = { title: 'Reports · SignForge Platform' };

export default async function Page({ searchParams }: { searchParams: Promise<ReportsSearchParams> }) {
  const { apiUnavailable, ...props } = await loadReportsProps('/platform/reports', 'platform', await searchParams);
  return (
    <>
      {apiUnavailable ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Platform reports" detail={apiUnavailable} />
        </div>
      ) : null}
      <Reports {...props} />
    </>
  );
}
