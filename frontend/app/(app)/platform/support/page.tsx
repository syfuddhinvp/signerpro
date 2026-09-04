import type { Metadata } from 'next';
import Support from '@/components/sf/screens/Support';
import { serverCaller } from '@/lib/api/client';
import { support as supportApi } from '@/lib/api/resources';
import { toQuickReplyPairs, toQueueTicketTiles } from '@/lib/sf/adapters';
import type { TicketDetailResponse, TicketPage } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Support · SignForge Platform' };

const EMPTY_PAGE: TicketPage = { items: [], total: 0, counts: { all: 0, open: 0, pending: 0, escalated: 0, resolved: 0 } };

export default async function Page() {
  const api = serverCaller('/platform/support');

  /* `scope=all` spans every tenant; the backend refuses it for a non-admin. */
  const [pageResult, statsResult, agentsResult, repliesResult] = await Promise.all([
    supportApi.ticketPage(api, { scope: 'all', limit: 200 }),
    supportApi.queueStats(api),
    supportApi.agents(api),
    supportApi.quickReplies(api),
  ]);

  const page = pageResult.ok ? pageResult.data : EMPTY_PAGE;
  const first = page.items[0];
  const detailResult = first ? await supportApi.ticket(api, first.id) : null;
  const detail: TicketDetailResponse | null = detailResult && detailResult.ok ? detailResult.data : null;

  return (
    <>
      {!pageResult.ok || !statsResult.ok || !agentsResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="The support queue" detail={(pageResult.ok ? null : pageResult.error.message) ?? (statsResult.ok ? null : statsResult.error.message) ?? (agentsResult.ok ? null : agentsResult.error.message)} />
        </div>
      ) : null}
      <Support
        page={page}
        detail={detail}
        agents={agentsResult.ok ? agentsResult.data : []}
        stats={toQueueTicketTiles(statsResult.ok ? statsResult.data : null)}
        quickReplies={toQuickReplyPairs(repliesResult.ok ? repliesResult.data : [])}
        scope="all"
      />
    </>
  );
}
