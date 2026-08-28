'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { btn, railHead } from '@/lib/sf/ui';
import { TENANTS, PLATFORM_STATS_META, MRR_SERIES, DUNNING, HEALTH, PLATFORM_AUDIT } from '@/lib/sf/data';

export default function PlatformHome() {
  const { s, flash, accent, initials } = useSF();
  const A = accent();
  void s;

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const superBannerStyle: CSSProperties = { background:'#0f172a', borderRadius:'14px', padding:'13px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'14px' };
  const superChip: CSSProperties = { padding:'4px 9px', borderRadius:'7px', background:'#f59e0b', color:'#3b1d00', fontSize:'10.5px', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", letterSpacing:'.06em', whiteSpace:'nowrap', flex:'0 0 auto' };
  const superBtn: CSSProperties = Object.assign(btn('transparent', '#e2e8f0', '#334155'), { flex:'0 0 auto' });
  const stepUp = () => flash('Step-up MFA satisfied · elevated session valid 15 min');

  const totalSeats = TENANTS.reduce((a, t) => a + t.seats, 0);
  const mrr = TENANTS.reduce((a, t) => a + t.mrr, 0);
  const tenantCount = String(TENANTS.length);
  const platformSeats = totalSeats.toLocaleString();

  const statValues: { [k: string]: string } = {
    'TENANTS': String(TENANTS.length),
    'SEATS PROVISIONED': totalSeats.toLocaleString(),
    'MRR': '$' + (mrr / 1000).toFixed(1) + 'k',
  };
  const platformStats = PLATFORM_STATS_META.map(x => ({
    label: x.label, value: statValues[x.label] ?? x.value ?? '', meta: x.meta,
    metaStyle: { fontSize:'11px', color: x.good ? '#047857' : '#c2410c', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties,
  }));

  const mrrChart = MRR_SERIES.map((v, i) => ({
    title: '$' + v + 'k MRR',
    wrap: { flex:'1', height:'100%', display:'flex', alignItems:'flex-end' } as CSSProperties,
    bar: { width:'100%', height: Math.round(v / 74.7 * 100) + '%', borderRadius:'5px 5px 2px 2px', background: i === MRR_SERIES.length - 1 ? '#10b981' : '#a7f3d0' } as CSSProperties,
  }));

  const maxMrr = Math.max.apply(null, TENANTS.map(t => t.mrr));
  const topTenants = TENANTS.slice().sort((a, b) => b.mrr - a.mrr).slice(0, 5).map(t => ({
    name: t.name, initials: initials(t.name), mrr: '$' + (t.mrr / 1000).toFixed(1) + 'k',
    chip: { width:'26px', height:'26px', borderRadius:'8px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'10px', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
    bar: { width: Math.round(t.mrr / maxMrr * 100) + '%', height:'100%', borderRadius:'99px', background: A } as CSSProperties,
  }));

  const dunning = DUNNING.map(([tenant, meta]) => ({
    tenant, meta,
    onRetry: () => flash('Charge retried for ' + tenant + ' · Stripe payment intent re-attempted'),
  }));

  const health = HEALTH.map(([label, meta, c]) => ({
    label, meta, dot: { width:'8px', height:'8px', borderRadius:'99px', background:c, flex:'0 0 8px' } as CSSProperties,
  }));

  const platformAudit = PLATFORM_AUDIT.map(([label, meta], i) => ({
    label, meta,
    dot: { width:'8px', height:'8px', borderRadius:'99px', marginTop:'5px', flex:'0 0 8px', background: i === 0 ? '#f59e0b' : '#334155' } as CSSProperties,
  }));

  return (
    <section data-screen-label="Platform overview" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={superBannerStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:'11px', minWidth:0 }}>
          <span style={superChip}>SUPER ADMIN</span>
          <span style={{ fontSize:'12.5px', color:'#cbd5e1', lineHeight:1.5 }}>Global scope · {tenantCount} tenants · {platformSeats} seats. Elevated session expires in 14 min.</span>
        </div>
        <button type="button" onClick={stepUp} style={superBtn}>Re-authenticate</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:'12px' }}>
        {platformStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'7px' }}>
            <span style={{ fontSize:'10.5px', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{st.label}</span>
            <span style={{ fontSize:'24px', fontWeight:700, letterSpacing:'-.8px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={railHead}>Net MRR · trailing 12 months</div>
            <span style={{ fontSize:'11px', color:'#047857', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>+118% NRR</span>
          </div>
          <div style={{ display:'flex', alignItems:'flex-end', gap:'7px', height:'150px' }}>
            {mrrChart.map((c, i) => (
              <div key={i} style={c.wrap} title={c.title}><div style={c.bar}></div></div>
            ))}
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}><span>Sep 25</span><span>Feb 26</span><span>Aug 26</span></div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Top tenants by revenue</div>
          {topTenants.map(t => (
            <div key={t.name} style={{ display:'flex', alignItems:'center', gap:'10px' }}>
              <span style={t.chip}>{t.initials}</span>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', flex:1, minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:'8px' }}>
                  <span style={{ fontSize:'12.5px', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.name}</span>
                  <span style={{ fontSize:'11.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#475569', flex:'0 0 auto' }}>{t.mrr}</span>
                </div>
                <div style={{ height:'4px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={t.bar}></div></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'16px', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Dunning queue</div>
          {dunning.map(d => (
            <div key={d.tenant} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'9px', border:'1px solid #eef1f6', borderRadius:'11px', background:'#fbfcfd' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                <span style={{ fontSize:'12.5px', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{d.tenant}</span>
                <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{d.meta}</span>
              </div>
              <button type="button" onClick={d.onRetry} style={ghostBtn}>Retry</button>
            </div>
          ))}
        </div>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Service health</div>
          {health.map(h => (
            <div key={h.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={{ fontSize:'12.5px', color:'#334155' }}>{h.label}</span>
              <span style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{h.meta}</span>
                <span style={h.dot}></span>
              </span>
            </div>
          ))}
        </div>
        <div style={{ background:'#0f172a', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ fontSize:'11px', letterSpacing:'.08em', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>RECENT ADMIN ACTIONS</div>
          {platformAudit.map((a, i) => (
            <div key={i} style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
              <span style={a.dot}></span>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                <span style={{ fontSize:'12.5px', color:'#e2e8f0', fontWeight:500 }}>{a.label}</span>
                <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", wordBreak:'break-all' }}>{a.meta}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
