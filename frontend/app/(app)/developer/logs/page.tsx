import type { Metadata } from 'next';
import Logs from '@/components/sf/screens/Logs';
import { serverCaller } from '@/lib/api/client';
import { account as accountApi, logs as logsApi } from '@/lib/api/resources';
import type { SystemLogPage } from '@/lib/api/types';

export const metadata: Metadata = { title: 'API logs · SignForge' };

/** The retention window the footer advertises. */
const SINCE_DAYS = 90;
const EMPTY_PAGE: SystemLogPage = { items: [], total: 0, sources: [], levels: [] };

export default async function Page() {
  const api = serverCaller('/developer/logs');

  const [pageResult, meResult] = await Promise.all([
    logsApi.tenant(api, { since_days: SINCE_DAYS, limit: 200 }),
    accountApi.me(api),
  ]);

  return (
    <Logs
      page={pageResult.ok ? pageResult.data : EMPTY_PAGE}
      scope="tenant"
      sinceDays={SINCE_DAYS}
      /* FALLBACK: the API has no tenant slug on /api/me, so the footer
         prints the organization name the design's slug stood in for. */
      orgSlug={(meResult.ok ? meResult.data.organization_name : null) || 'your organization'}
    />
  );
}
