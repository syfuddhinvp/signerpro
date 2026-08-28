import type { Metadata } from 'next';
import Support from '@/components/sf/screens/Support';
import { serverCaller } from '@/lib/api/client';
import { support as supportApi } from '@/lib/api/resources';
import { toQuickReplyPairs, toTenantTicketTiles } from '@/lib/sf/adapters';
import type { TicketDetailResponse, TicketPage } from '@/lib/api/types';

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
    <Support
      page={page}
      detail={detail}
      /* `GET /api/support/agents` requires platform admin — a tenant caller has
         no roster, so the assignee select shows only the current holder. */
      agents={[]}
      stats={toTenantTicketTiles(statsResult.ok ? statsResult.data : null)}
      quickReplies={toQuickReplyPairs(repliesResult.ok ? repliesResult.data : [])}
      scope={undefined}
    />
  );
}
