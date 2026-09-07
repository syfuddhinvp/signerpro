/**
 * Platform revenue — server component.
 *
 * `GET /api/saas/revenue` (seat-aware MRR, `mrr_series`, `by_plan`),
 * `GET /api/saas/revenue/churn?range=` (the range is a URL search param so a
 * link is shareable), `GET /api/saas/balance`, `GET /api/saas/billing-events`,
 * and the org's `live_mode_enabled` from `/api/organizations/me/api-settings`.
 */

import type { Metadata } from 'next';
import Revenue from '@/components/sf/screens/Revenue';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import { serverCaller } from '@/lib/api/client';
import { organizations as organizationsApi, revenue as revenueApi } from '@/lib/api/resources';
import {
  formatCents,
  toBalanceTiles,
  toBillingEventRows,
  toChurnRows,
  toRevenueStats,
  toSubsByPlan,
} from '@/lib/sf/adapters';
import type { BalanceResponse, ChurnResponse, RevenueSummary } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Revenue · SignerPro Platform' };

const CHURN_RANGES = ['3m', '6m', '12m'];

const EMPTY_SUMMARY: RevenueSummary = {
  mrr_cents: 0, arr_cents: 0, collected_cents: 0, outstanding_cents: 0, overdue_cents: 0,
  paying_tenants: 0, trialing_tenants: 0, series: [], by_plan: [],
  gross_volume_30d_cents: 0, charge_count_30d: 0, failed_payment_count: 0, at_risk_cents: 0,
  mrr_change_pct: 0, mrr_series: [],
};

const EMPTY_BALANCE: BalanceResponse = {
  currency: 'USD', available_cents: 0, pending_cents: 0, pending_settles_at: null,
  next_payout_cents: 0, next_payout_at: null, payout_destination: 'provider',
  disputes_cents: 0, dispute_count: 0, dispute_rate_pct: 0,
};

const EMPTY_CHURN: ChurnResponse = {
  range: '12m', gross_logo_churn_pct: 0, net_revenue_retention_pct: 0,
  involuntary_churn_pct: 0, trial_conversion_pct: 0, rows: [],
};

type SearchParams = { [key: string]: string | string[] | undefined };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const rangeParam = one(query.range);
  const range = rangeParam && CHURN_RANGES.includes(rangeParam) ? rangeParam : '12m';

  const api = serverCaller('/platform/revenue');

  const [summaryResult, churnResult, balanceResult, eventsResult, settingsResult] = await Promise.all([
    revenueApi.summary(api),
    revenueApi.churn(api, { range }),
    revenueApi.balance(api),
    revenueApi.billingEvents(api, { limit: 50 }),
    organizationsApi.apiSettings(api),
  ]);

  const summary = summaryResult.ok ? summaryResult.data : EMPTY_SUMMARY;
  const churn = churnResult.ok ? churnResult.data : EMPTY_CHURN;
  const balance = balanceResult.ok ? balanceResult.data : EMPTY_BALANCE;
  const events = eventsResult.ok ? eventsResult.data : [];
  const liveMode = settingsResult.ok ? settingsResult.data.live_mode_enabled : true;

  const delivered = events.filter(e => e.processed && !e.error).length;
  const destination = balance.payout_destination || 'Provider';

  /* $0 MRR because the book is empty and $0 MRR because Stripe is unreachable
     are different facts. Say which one this is. */
  const revenueError = !summaryResult.ok ? summaryResult.error.message
    : !balanceResult.ok ? balanceResult.error.message
    : !churnResult.ok ? churnResult.error.message
    : null;

  return (
    <>
      {revenueError ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Revenue, balance and churn figures" detail={revenueError} />
        </div>
      ) : null}
      <Revenue
      stats={toRevenueStats(summary)}
      balanceTiles={toBalanceTiles(balance)}
      subsByPlan={toSubsByPlan(summary)}
      churnRows={toChurnRows(churn)}
      events={toBillingEventRows(events)}
      payoutDestination={destination[0].toUpperCase() + destination.slice(1)}
      deliveredPct={(events.length ? Math.round(delivered * 100 / events.length) : 100) + '%'}
      availableLabel={formatCents(balance.available_cents, balance.currency || 'USD')}
        liveMode={liveMode}
      />
    </>
  );
}
