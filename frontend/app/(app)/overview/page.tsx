/**
 * Tenant overview (ORG-2).
 *
 * One aggregate drives the whole screen: `GET /api/organizations/me/overview`
 * returns the stat tiles, a twelve-bucket envelope series, the attention items
 * (each with the route it links to), invoiced spend lines and team activity —
 * all derived at request time, so nothing here can drift from the rows.
 *
 * The range is fixed at `90d` because the design's chart is labelled "last 12
 * weeks" and the service always cuts the window into twelve buckets: 90 / 12 =
 * 7.5 days, i.e. the weekly bars the axis claims.
 *
 * `GET /api/organizations/me` + `GET /api/billing/subscription` fill the banner
 * (name, slug, plan, region, renewal date).
 */

import type { Metadata } from 'next';
import TenantHome from '@/components/sf/screens/TenantHome';
import { serverCaller } from '@/lib/api/client';
import { billing as billingApi, organizations as organizationsApi } from '@/lib/api/resources';
import {
  EMPTY_ORG_OVERVIEW,
  toOverviewAttention,
  toOverviewBanner,
  toOverviewSpend,
  toOverviewStats,
  toOverviewTeam,
  toSeriesLabels,
  type OrganizationOverviewResponse,
  type OrganizationProfileExtras,
} from '@/lib/sf/adapters';

export const metadata: Metadata = { title: 'Overview · SignForge' };

const OVERVIEW_RANGE = '90d';

export default async function Page() {
  const api = serverCaller('/overview');

  const [overviewResult, orgResult, subscriptionResult] = await Promise.all([
    // Not in `lib/api/resources.ts` yet (the consolidation agent owns that
    // file); the caller is the same transport a resource function would use.
    api<OrganizationOverviewResponse>('/api/organizations/me/overview', {
      method: 'GET',
      query: { range: OVERVIEW_RANGE },
    }),
    organizationsApi.me(api),
    billingApi.subscription(api),
  ]);

  const overview = overviewResult.ok ? overviewResult.data : EMPTY_ORG_OVERVIEW;
  const org = orgResult.ok ? (orgResult.data as unknown as OrganizationProfileExtras) : null;
  const subscription = subscriptionResult.ok ? subscriptionResult.data : null;

  const series = overview.series?.length ? overview.series : EMPTY_ORG_OVERVIEW.series;

  return (
    <TenantHome
      banner={toOverviewBanner(org, subscription)}
      stats={toOverviewStats(overview)}
      series={series}
      seriesLabels={toSeriesLabels(overview.range || OVERVIEW_RANGE, series.length)}
      attention={toOverviewAttention(overview.attention ?? [])}
      spend={toOverviewSpend(overview.spend_lines ?? [])}
      team={toOverviewTeam(overview.team ?? [])}
      nextInvoiceMeta={subscriptionNote(subscription)}
    />
  );
}

/** The design's "due 1 Sep · autopay on" line, from the real subscription. */
function subscriptionNote(
  subscription: { next_invoice_at?: string | null; cancel_at_period_end?: boolean } | null,
): string {
  if (!subscription) return '';
  const parts: string[] = [];
  if (subscription.next_invoice_at) {
    parts.push(`due ${new Date(subscription.next_invoice_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
  }
  parts.push(subscription.cancel_at_period_end ? 'cancels at period end' : 'autopay on');
  return parts.join(' · ');
}
