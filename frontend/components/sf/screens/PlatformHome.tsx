'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { btn, railHead, TEXT_MUTED, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { platformInvoices as platformInvoicesApi } from '@/lib/api/resources';
import type {
  AuditStreamRow,
  DunningQueueRow,
  PlatformHealthTile,
  PlatformStatTile,
  TopTenantRow,
} from '@/lib/sf/adapters';

/**
 * Server data, adapted in `app/(app)/platform/page.tsx`:
 * `GET /api/saas/overview` (tiles, MRR series, health), `GET /api/saas/tenants`
 * (top tenants by MRR), `GET /api/saas/dunning`, `GET /api/saas/audit` and
 * `GET /api/saas/revenue/churn` (the NRR badge on the chart).
 */
export type PlatformHomeProps = {
  stats: PlatformStatTile[];
  /** Trailing-12-month MRR in `$k`, oldest → newest. */
  mrrSeries: number[];
  /** Three axis labels under the chart (first · middle · last month). */
  mrrTicks: [string, string, string];
  /** `+118% NRR` — net revenue retention from the churn endpoint. */
  nrrLabel: string;
  tenantCount: string;
  seatsLabel: string;
  topTenants: TopTenantRow[];
  dunning: DunningQueueRow[];
  health: PlatformHealthTile[];
  audit: AuditStreamRow[];
};

export default function PlatformHome({
  stats, mrrSeries, mrrTicks, nrrLabel, tenantCount, seatsLabel, topTenants, dunning, health, audit,
}: PlatformHomeProps) {
  const { flash, accent, initials } = useSF();
  const router = useRouter();
  const A = accent();
  const [retrying, setRetrying] = useState<string | null>(null);

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const superBannerStyle: CSSProperties = { background:'#0f172a', borderRadius:'14px', padding:'13px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'14px' };
  const superChip: CSSProperties = { padding:'4px 9px', borderRadius:'7px', background:'#f59e0b', color:'#3b1d00', fontSize:'.65625rem', fontWeight:700, fontFamily:'var(--font-sans)', letterSpacing:'.06em', whiteSpace:'nowrap', flex:'0 0 auto' };

  const emptyNote: CSSProperties = { fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.6 };

  const platformStats = stats.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize:'.6875rem', color: x.good ? '#047857' : '#c2410c', fontFamily:'var(--font-sans)' } as CSSProperties,
  }));

  /* The prototype scaled bars against a hardcoded 74.7; scale against the
     series maximum so any tenant book renders sensibly. */
  const maxSeries = mrrSeries.reduce((a, v) => Math.max(a, v), 0);
  const mrrChart = mrrSeries.map((v, i) => ({
    title: '$' + v + 'k MRR',
    wrap: { flex:'1', height:'100%', display:'flex', alignItems:'flex-end' } as CSSProperties,
    bar: { width:'100%', height: (maxSeries ? Math.round(v / maxSeries * 100) : 0) + '%', borderRadius:'5px 5px 2px 2px', background: i === mrrSeries.length - 1 ? '#10b981' : '#a7f3d0' } as CSSProperties,
  }));

  const maxMrr = topTenants.reduce((a, t) => Math.max(a, t.mrrCents), 0);
  const tenantRows = topTenants.map(t => ({
    id: t.id, name: t.name, initials: initials(t.name), mrr: t.mrr,
    chip: { width:'26px', height:'26px', borderRadius:'8px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'.625rem', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
    bar: { width: (maxMrr ? Math.round(t.mrrCents / maxMrr * 100) : 0) + '%', height:'100%', borderRadius:'99px', background: A } as CSSProperties,
  }));

  const retryCharge = (row: DunningQueueRow) => {
    /* Optimistic toast first, as the prototype does. */
    flash('Charge retried for ' + row.tenant + ' · payment re-attempted');
    if (!row.invoiceId) { flash('No invoice on this dunning row · nothing to retry'); return; }
    setRetrying(row.key);
    void platformInvoicesApi.retryPayment(apiCall, row.invoiceId).then(res => {
      setRetrying(null);
      if (!res.ok) { flash('Retry failed for ' + row.tenant + ' · ' + res.error.message); return; }
      flash(row.tenant + ' · ' + (res.data.number ?? 'invoice') + ' is now ' + res.data.status);
      router.refresh();
    });
  };

  const dunningRows = dunning.map(d => ({
    key: d.key, tenant: d.tenant, meta: d.meta,
    label: retrying === d.key ? 'Retrying…' : 'Retry',
    onRetry: () => retryCharge(d),
  }));

  const healthRows = health.map(h => ({
    label: h.label, meta: h.meta,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background: h.color, flex:'0 0 8px' } as CSSProperties,
  }));

  const platformAudit = audit.map((a, i) => ({
    key: a.key, label: a.label, meta: a.meta,
    dot: { width:'8px', height:'8px', borderRadius:'99px', marginTop:'5px', flex:'0 0 8px', background: i === 0 ? '#f59e0b' : '#334155' } as CSSProperties,
  }));

  return (
    <section data-screen-label="Platform overview" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={superBannerStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:'11px', minWidth:0 }}>
          <span style={superChip}>SUPER ADMIN</span>
          <span style={{ fontSize:'.78125rem', color:TEXT_ON_DARK, lineHeight:1.5 }}>Global scope · {tenantCount} tenants · {seatsLabel} seats.</span>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:'12px' }}>
        {platformStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'7px' }}>
            <span style={{ fontSize:'.65625rem', letterSpacing:'.06em', color:'#64748b', fontFamily:'var(--font-sans)' }}>{st.label}</span>
            <span style={{ fontSize:'1.5rem', fontWeight:700, letterSpacing:'-.8px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={railHead}>Net MRR · trailing 12 months</div>
            <span style={{ fontSize:'.6875rem', color:'#047857', fontFamily:'var(--font-sans)' }}>{nrrLabel}</span>
          </div>
          <div style={{ display:'flex', alignItems:'flex-end', gap:'7px', height:'150px' }}>
            {mrrChart.map((c, i) => (
              <div key={i} style={c.wrap} title={c.title}><div style={c.bar}></div></div>
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}><span>{mrrTicks[0]}</span><span>{mrrTicks[1]}</span><span>{mrrTicks[2]}</span></div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Top tenants by revenue</div>
          {tenantRows.length ? tenantRows.map(t => (
            <div key={t.id} style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <span style={t.chip}>{t.initials}</span>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', flex:1, minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:'8px' }}>
                  <span style={{ fontSize:'.78125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.name}</span>
                  <span style={{ fontSize:'.71875rem', fontFamily:'var(--font-sans)', color:'#475569', flex:'0 0 auto' }}>{t.mrr}</span>
                </div>
                <div style={{ height:'4px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={t.bar}></div></div>
              </div>
            </div>
          )) : (<span style={emptyNote}>No tenants yet.</span>)}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'16px', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Dunning queue</div>
          {dunningRows.length ? dunningRows.map(d => (
            <div key={d.key} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'9px', border:'1px solid #eef1f6', borderRadius:'11px', background:'#fbfcfd' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                <span style={{ fontSize:'.78125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.tenant}</span>
                <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{d.meta}</span>
              </div>
              <button type="button" onClick={d.onRetry} style={ghostBtn}>{d.label}</button>
            </div>
          )) : (<span style={emptyNote}>No invoices in collection.</span>)}
        </div>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Service health</div>
          {healthRows.length ? healthRows.map(h => (
            <div key={h.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={{ fontSize:'.78125rem', color:'#334155' }}>{h.label}</span>
              <span style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{h.meta}</span>
                <span style={h.dot}></span>
              </span>
            </div>
          )) : (<span style={emptyNote}>Health data unavailable.</span>)}
        </div>
        <div style={{ background:'#0f172a', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ fontSize:'.6875rem', letterSpacing:'.08em', color:TEXT_MUTED_ON_DARK, fontFamily:'var(--font-sans)' }}>RECENT ADMIN ACTIONS</div>
          {platformAudit.length ? platformAudit.map(a => (
            <div key={a.key} style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
              <span style={a.dot}></span>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                <span style={{ fontSize:'.78125rem', color:'#e2e8f0', fontWeight:500 }}>{a.label}</span>
                <span style={{ fontSize:'.65625rem', color:'#64748b', fontFamily:'var(--font-sans)', wordBreak:'break-all' }}>{a.meta}</span>
              </div>
            </div>
          )) : (<span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.6 }}>No administrative actions recorded yet.</span>)}
        </div>
      </div>
    </section>
  );
}
