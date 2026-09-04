import type { Metadata } from 'next';
import Support from '@/components/sf/screens/Support';
import { serverCaller } from '@/lib/api/client';
import { support as supportApi } from '@/lib/api/resources';
import { toQuickReplyPairs, toTenantTicketTiles } from '@/lib/sf/adapters';
import type { TicketDetailResponse, TicketPage } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Support · SignForge' };

const EMPTY_PAGE: TicketPage = { items: [], total: 0, counts: { all: 0, open: 0, pending: 0, escalated: 0, resolved: 0 } };

export default async function Page() {
  const api = serverCaller('/support');

  const [pageResult, statsResult, repliesResult] = await Promise.all([
    supportApi.ticketPage(api, { limit: 200 }),
    supportApi.stats(api),
    supportApi.quickReplies(api),
  ]);

  const page = pageResult.ok ? pageResult.data : EMPTY_PAGE;
  const first = page.items[0];
  const detailResult = first ? await supportApi.ticket(api, first.id) : null;
  const detail: TicketDetailResponse | null = detailResult && detailResult.ok ? detailResult.data : null;

  return (
    /* Substituting EMPTY_PAGE on a failed load and rendering nothing else made
       an outage look like a healthy, empty workspace: the screen states
       "You have no support tickets yet" -- a confident claim about the
       account, from a request that never answered. The platform twin already
       guards this; the tenant route was missed. */
    <>
      {!pageResult.ok || !statsResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Your support tickets" detail={(pageResult.ok ? null : pageResult.error.message) ?? (statsResult.ok ? null : statsResult.error.message)} />
        </div>
      ) : null}
      <Support
        page={page}
        detail={detail}
        /* `GET /api/support/agents` requires platform admin — a tenant caller
           has no roster, so the assignee select shows only the current holder. */
        agents={[]}
        stats={toTenantTicketTiles(statsResult.ok ? statsResult.data : null)}
        quickReplies={toQuickReplyPairs(repliesResult.ok ? repliesResult.data : [])}
        scope={undefined}
      />
    </>
  );
}
