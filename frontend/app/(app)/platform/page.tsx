/**
 * Platform overview (super admin home) — server component.
 *
 * `GET /api/saas/overview` owns the tiles, the trailing-12-month MRR series and
 * component health; the rails come from `/api/saas/tenants`, `/api/saas/dunning`,
 * `/api/saas/audit` and `/api/saas/revenue/churn`. Every one of them is
 * platform-only; the route group is already guarded by `requirePlatformSession`.
 */

import type { Metadata } from 'next';
import PlatformHome from '@/components/sf/screens/PlatformHome';
import { serverCaller } from '@/lib/api/client';
import {
  logs as logsApi,
  revenue as revenueApi,
  tenants as tenantsApi,
} from '@/lib/api/resources';
import {
  toDunningRows,
  toMrrMonthTicks,
  toMrrSeriesK,
  toPlatformAuditStream,
  toPlatformHealthRows,
  toPlatformStats,
  toTopTenants,
} from '@/lib/sf/adapters';
import type { PlatformOverview } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Platform · SignForge' };

const EMPTY_OVERVIEW: PlatformOverview = {
  tenants: { total: 0, trial: 0, suspended: 0, active: 0 },
  seats: { provisioned: 0, activated: 0 },
  envelopes_30d: 0,
  mrr_cents: 0,
  incidents_90d: 0,
  uptime_pct: 100,
  mrr_series: [],
  health: [],
};

export default async function Page() {
  const api = serverCaller('/platform');

  const [overviewResult, tenantsResult, dunningResult, auditResult, churnResult] = await Promise.all([
    tenantsApi.overview(api),
    tenantsApi.list(api, { limit: 200 }),
    revenueApi.dunning(api),
    logsApi.platformAudit(api, { limit: 5 }),
    revenueApi.churn(api, { range: '12m' }),
  ]);

  const overview = overviewResult.ok ? overviewResult.data : EMPTY_OVERVIEW;
  const tenantRows = tenantsResult.ok ? tenantsResult.data.items : [];
  const dunning = dunningResult.ok ? dunningResult.data : [];
  const audit = auditResult.ok ? auditResult.data.items : [];
  const churn = churnResult.ok ? churnResult.data : null;

  const series = toMrrSeriesK(overview.mrr_series);
  const ticks = toMrrMonthTicks(series.length || 12);
  const mid = ticks.length ? ticks[Math.floor((ticks.length - 1) / 2)] : '';
  /* The design's "+118% NRR" badge: net revenue retention, signed the way the
     prototype signs it (a book that is retaining above 100% reads as a gain). */
  const nrr = churn?.net_revenue_retention_pct ?? 0;
  const nrrLabel = churn ? (nrr >= 100 ? '+' : '') + nrr.toFixed(0) + '% NRR' : '—';

  return (
    <PlatformHome
      stats={toPlatformStats(overview)}
      mrrSeries={series}
      mrrTicks={[ticks[0] ?? '', mid, ticks[ticks.length - 1] ?? '']}
      nrrLabel={nrrLabel}
      tenantCount={String(overview.tenants.total)}
      seatsLabel={overview.seats.provisioned.toLocaleString()}
      topTenants={toTopTenants(tenantRows)}
      dunning={toDunningRows(dunning)}
      health={toPlatformHealthRows(overview.health)}
      audit={toPlatformAuditStream(audit)}
    />
  );
}
