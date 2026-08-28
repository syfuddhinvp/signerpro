import type { Metadata } from 'next';
import Logs from '@/components/sf/screens/Logs';
import { serverCaller } from '@/lib/api/client';
import { logs as logsApi } from '@/lib/api/resources';
import type { SystemLogPage } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Logs · SignForge Platform' };

const SINCE_DAYS = 90;
const EMPTY_PAGE: SystemLogPage = { items: [], total: 0, sources: [], levels: [] };

export default async function Page() {
  const api = serverCaller('/platform/logs');

  const [pageResult] = await Promise.all([
    logsApi.platform(api, { since_days: SINCE_DAYS, limit: 200 }),
  ]);

  return (
    <Logs
      page={pageResult.ok ? pageResult.data : EMPTY_PAGE}
      scope="platform"
      sinceDays={SINCE_DAYS}
      /* The platform footer prints "all tenants", so no single slug applies. */
      orgSlug="all tenants"
    />
  );
}
