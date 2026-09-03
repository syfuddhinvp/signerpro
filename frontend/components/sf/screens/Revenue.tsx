'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { btn, pill, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { organizations as organizationsApi, revenue as revenueApi } from '@/lib/api/resources';
import type { BillingEventRow, PlatformStatTile } from '@/lib/sf/adapters';

/**
 * Server data, adapted in `app/(app)/platform/revenue/page.tsx`:
 * `GET /api/saas/revenue` (seat-aware MRR + plan mix),
 * `GET /api/saas/revenue/churn`, `GET /api/saas/balance`,
 * `GET /api/saas/billing-events`, and `live_mode_enabled` from
 * `GET /api/organizations/me/api-settings`.
 */
export type RevenueProps = {
  stats: PlatformStatTile[];
  balanceTiles: { label: string; value: string; meta: string }[];
  subsByPlan: { name: string; meta: string; pct: number }[];
  churnRows: { k: string; v: string; tone: string }[];
  events: BillingEventRow[];
  /** `payout_destination` from the balance endpoint (the provider's name). */
  payoutDestination: string;
  /** Delivery success rate across the fetched provider events. */
  deliveredPct: string;
  /** Available balance, for the payout confirmation copy. */
  availableLabel: string;
  /** The organization's `live_mode_enabled` setting. */
  liveMode: boolean;
};

export default function Revenue({
  stats, balanceTiles, subsByPlan, churnRows, events, payoutDestination, deliveredPct, availableLabel, liveMode: initialLiveMode,
}: RevenueProps) {
  const { flash, accent } = useSF();
  const router = useRouter();
  const A = accent();

  /* `live_mode_enabled` is server state; this mirror exists only so the pill
     flips with the click before the PATCH comes back. */
  const [live, setLive] = useState(initialLiveMode);
  const [replaying, setReplaying] = useState<string | null>(null);

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const emptyNote: CSSProperties = { fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.6 };

  const revenueStats = stats.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize:'.6875rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: x.good ? '#047857' : '#c2410c' } as CSSProperties,
  }));

  const planBars = subsByPlan.map(p => ({
    name: p.name, meta: p.meta,
    bar: { width: p.pct + '%', height:'100%', borderRadius:'99px', background: A } as CSSProperties,
  }));

  const churn = churnRows.map(r => ({
    k: r.k, v: r.v,
    style: { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontWeight:600, color: r.tone === 'good' ? '#047857' : '#c2410c' } as CSSProperties,
  }));

  const replayEvent = (row: BillingEventRow) => {
    flash(row.type + ' replayed · ' + row.ref);
    setReplaying(row.id);
    void revenueApi.replayBillingEvent(apiCall, row.id).then(res => {
      setReplaying(null);
      if (!res.ok) { flash('Replay failed · ' + res.error.message); return; }
      flash(res.data.event_type + ' · ' + (res.data.error ? 'failed: ' + res.data.error : 'processed'));
      router.refresh();
    });
  };

  const webhooks = events.map(e => ({
    id: e.id, type: e.type, ref: e.ref, status: e.status, ts: e.ts,
    label: replaying === e.id ? 'Replaying…' : 'Replay',
    pill: pill(e.good ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }),
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'10px 15px', borderTop:'1px solid #f2f4f8', flexWrap:'wrap' } as CSSProperties,
    onReplay: () => replayEvent(e),
  }));

  const liveModeLabel = live ? 'LIVE MODE' : 'TEST MODE';
  const liveModePill = pill(live ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' });

  const toggleLiveMode = () => {
    const next = !live;
    setLive(next);
    flash(next ? 'Switched to live mode' : 'Switched to test mode · no live charges');
    void organizationsApi.updateApiSettings(apiCall, { live_mode_enabled: next }).then(res => {
      if (!res.ok) { setLive(!next); flash('Could not change mode · ' + res.error.message); return; }
      router.refresh();
    });
  };

  /* There is no payout endpoint (`POST /api/saas/payouts` 404s), so there is
     no "Request payout" control. The prototype's button flashed a confirmation
     for a transfer that never happened. */

  return (
    <section data-screen-label="Revenue" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:'12px' }}>
        {revenueStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'15px 16px', display:'flex', flexDirection:'column', gap:'7px' }}>
            <span style={{ fontSize:'.65625rem', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{st.label}</span>
            <span style={{ fontSize:'1.5rem', fontWeight:700, letterSpacing:'-.8px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={railHead}>{payoutDestination} balance &amp; payouts</div>
            <span style={liveModePill}>{liveModeLabel}</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'11px' }}>
            {balanceTiles.map(b => (
              <div key={b.label} style={{ border:'1px solid #eef1f6', borderRadius:'12px', padding:'12px', background:'#fbfcfd', display:'flex', flexDirection:'column', gap:'4px' }}>
                <span style={{ fontSize:'.65625rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{b.label}</span>
                <span style={{ fontSize:'1.125rem', fontWeight:700, letterSpacing:'-.4px' }}>{b.value}</span>
                <span style={{ fontSize:'.65625rem', color:'#64748b' }}>{b.meta}</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button type="button" onClick={toggleLiveMode} style={ghostBtn}>Toggle test mode</button>
          </div>
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Subscriptions by plan</div>
          {planBars.length ? planBars.map(p => (
            <div key={p.name} style={{ display:'flex', alignItems:'center', gap:'11px' }}>
              <span style={{ width:'88px', fontSize:'.78125rem', color:'#334155', flex:'0 0 88px' }}>{p.name}</span>
              <div style={{ flex:1, height:'8px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={p.bar}></div></div>
              <span style={{ width:'118px', textAlign:'right', fontSize:'.71875rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#475569', flex:'0 0 118px' }}>{p.meta}</span>
            </div>
          )) : (<span style={emptyNote}>No subscriptions yet.</span>)}
          <div style={{ borderTop:'1px solid #f2f4f8', paddingTop:'11px', display:'flex', flexDirection:'column', gap:'7px' }}>
            {churn.map(c => (
              <div key={c.k} style={{ display:'flex', justifyContent:'space-between', fontSize:'.75rem' }}>
                <span style={{ color:'#64748b' }}>{c.k}</span><span style={c.style}>{c.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
        <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
          <div style={railHead}>{payoutDestination} webhook events</div>
          <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{events.length} events · {deliveredPct} delivered</span>
        </div>
        {webhooks.length ? webhooks.map(w => (
          <div key={w.id} style={w.rowStyle}>
            <span style={w.pill}>{w.status}</span>
            <span style={{ fontSize:'.75rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#0f172a', flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{w.type}</span>
            <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' }}>{w.ref}</span>
            <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' }}>{w.ts}</span>
            <button type="button" onClick={w.onReplay} style={ghostBtn}>{w.label}</button>
          </div>
        )) : (
          <div style={{ padding:'22px 15px', fontSize:'.78125rem', color:'#64748b' }}>No provider events received yet.</div>
        )}
      </div>
    </section>
  );
}
