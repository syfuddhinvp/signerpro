'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { btn, pill, railHead } from '@/lib/sf/ui';

/* ── revenue (platform) ── */
const REVENUE_STATS: { label: string; value: string; meta: string; good: boolean }[] = [
  { label:'MRR', value:'$74.7k', meta:'+4.2% MoM', good:true },
  { label:'ARR', value:'$896k', meta:'118% NRR', good:true },
  { label:'GROSS VOLUME · 30D', value:'$81.3k', meta:'42 charges', good:true },
  { label:'FAILED PAYMENTS', value:'2', meta:'$4.6k at risk', good:false }
];

const BALANCE_TILES: { label: string; value: string; meta: string }[] = [
  { label:'AVAILABLE', value:'$62,418', meta:'usd · instant payout eligible' },
  { label:'PENDING', value:'$18,905', meta:'settles in 2 days' },
  { label:'NEXT PAYOUT', value:'$62,418', meta:'29 Aug · Chase •••• 3391' },
  { label:'DISPUTES', value:'$0', meta:'0 open · 0.0% rate' }
];

const SUBS_BY_PLAN: { name: string; count: number; mrr: number; pct: number }[] = [
  { name:'Enterprise', count:3, mrr:70080, pct:94 },
  { name:'Business', count:2, mrr:4320, pct:22 },
  { name:'Team', count:1, mrr:288, pct:6 }
];

const CHURN_ROWS: { k: string; v: string; tone: string }[] = [
  { k:'Gross churn (logo)', v:'1.2%', tone:'good' }, { k:'Net revenue retention', v:'118%', tone:'good' },
  { k:'Involuntary churn (payments)', v:'0.4%', tone:'warn' }, { k:'Trial → paid conversion', v:'62%', tone:'good' }
];

const STRIPE_WEBHOOKS: [string, string, string, string, string][] = [
  ['invoice.paid', 'evt_1QhT7a', '200', '11:58:02', 'good'],
  ['customer.subscription.updated', 'evt_1QhT52', '200', '11:41:18', 'good'],
  ['checkout.session.completed', 'evt_1QhSz9', '200', '10:22:47', 'good'],
  ['invoice.payment_failed', 'evt_1QhSw1', '502', '09:47:11', 'bad'],
  ['payment_intent.succeeded', 'evt_1QhSm4', '200', '09:12:36', 'good'],
  ['customer.subscription.trial_will_end', 'evt_1QhSg8', '200', '08:04:52', 'good']
];

export default function Revenue() {
  const { s, set, flash, accent } = useSF();
  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const revenueStats = REVENUE_STATS.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize:'11px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: x.good ? '#047857' : '#c2410c' } as CSSProperties
  }));

  const subsByPlan = SUBS_BY_PLAN.map(p => ({
    name: p.name,
    meta: p.count + ' subs · $' + (p.mrr / 1000).toFixed(1) + 'k',
    bar: { width: p.pct + '%', height:'100%', borderRadius:'99px', background: A } as CSSProperties
  }));

  const churnRows = CHURN_ROWS.map(r => ({
    k: r.k, v: r.v,
    style: { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontWeight:600, color: r.tone === 'good' ? '#047857' : '#c2410c' } as CSSProperties
  }));

  const webhooks = STRIPE_WEBHOOKS.map(([type, id, status, ts, tone]) => ({
    type, id, status, ts,
    pill: pill(tone === 'good' ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }),
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'10px 15px', borderTop:'1px solid #f2f4f8', flexWrap:'wrap' } as CSSProperties,
    onReplay: () => flash(type + ' replayed · ' + id)
  }));

  const liveMode = s.liveMode ? 'LIVE MODE' : 'TEST MODE';
  const liveModePill = pill(s.liveMode ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' });
  const toggleLiveMode = () => { set({ liveMode: !s.liveMode }); flash(s.liveMode ? 'Switched to test mode · no live charges' : 'Switched to live mode'); };
  const payout = () => flash('Payout of $62,418.00 created · arrives 29 Aug');

  return (
    <section data-screen-label="Revenue" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:'12px' }}>
        {revenueStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'15px 16px', display:'flex', flexDirection:'column', gap:'7px' }}>
            <span style={{ fontSize:'10.5px', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{st.label}</span>
            <span style={{ fontSize:'24px', fontWeight:700, letterSpacing:'-.8px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={railHead}>Stripe balance &amp; payouts</div>
            <span style={liveModePill}>{liveMode}</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'11px' }}>
            {BALANCE_TILES.map(b => (
              <div key={b.label} style={{ border:'1px solid #eef1f6', borderRadius:'12px', padding:'12px', background:'#fbfcfd', display:'flex', flexDirection:'column', gap:'4px' }}>
                <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{b.label}</span>
                <span style={{ fontSize:'18px', fontWeight:700, letterSpacing:'-.4px' }}>{b.value}</span>
                <span style={{ fontSize:'10.5px', color:'#64748b' }}>{b.meta}</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:'8px' }}>
            <button type="button" onClick={payout} style={primaryBtn}>Create payout</button>
            <button type="button" onClick={toggleLiveMode} style={ghostBtn}>Toggle test mode</button>
          </div>
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Subscriptions by plan</div>
          {subsByPlan.map(p => (
            <div key={p.name} style={{ display:'flex', alignItems:'center', gap:'11px' }}>
              <span style={{ width:'88px', fontSize:'12.5px', color:'#334155', flex:'0 0 88px' }}>{p.name}</span>
              <div style={{ flex:1, height:'8px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={p.bar}></div></div>
              <span style={{ width:'118px', textAlign:'right', fontSize:'11.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#475569', flex:'0 0 118px' }}>{p.meta}</span>
            </div>
          ))}
          <div style={{ borderTop:'1px solid #f2f4f8', paddingTop:'11px', display:'flex', flexDirection:'column', gap:'7px' }}>
            {churnRows.map(c => (
              <div key={c.k} style={{ display:'flex', justifyContent:'space-between', fontSize:'12px' }}>
                <span style={{ color:'#64748b' }}>{c.k}</span><span style={c.style}>{c.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
        <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
          <div style={railHead}>Stripe webhook events</div>
          <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>endpoint we_1Qh… · 99.8% delivered</span>
        </div>
        {webhooks.map(w => (
          <div key={w.id} style={w.rowStyle}>
            <span style={w.pill}>{w.status}</span>
            <span style={{ fontSize:'12px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#0f172a', flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{w.type}</span>
            <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' }}>{w.id}</span>
            <span style={{ fontSize:'11px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' }}>{w.ts}</span>
            <button type="button" onClick={w.onReplay} style={ghostBtn}>Replay</button>
          </div>
        ))}
      </div>
    </section>
  );
}
