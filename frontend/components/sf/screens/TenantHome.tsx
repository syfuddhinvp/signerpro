'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { ORG_STATS, ORG_SERIES, ORG_ATTENTION, ORG_SPEND_LINES, ORG_TEAM, TOUR, ACCENT_DEFAULT } from '@/lib/sf/data';
import { btn, railHead } from '@/lib/sf/ui';

export default function TenantHome() {
  const { accent, set, initials } = useSF();
  const A = accent();

  const orgStats = ORG_STATS.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize: '11.5px', fontWeight: 600, fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: x.good ? '#047857' : '#c2410c' } as CSSProperties,
    bar: { width: x.pct + '%', height: '100%', borderRadius: '99px', background: x.good ? '#10b981' : '#f59e0b' } as CSSProperties,
  }));

  const orgChart = ORG_SERIES.map((v, i) => ({
    title: 'W' + (23 + i) + ' · ' + v + ' envelopes',
    wrap: { flex: '1', height: '100%', display: 'flex', alignItems: 'flex-end' } as CSSProperties,
    bar: { width: '100%', height: Math.round(v / 612 * 100) + '%', borderRadius: '5px 5px 2px 2px', background: i === ORG_SERIES.length - 1 ? A : '#c7d2fe' } as CSSProperties,
  }));

  const orgAttention = ORG_ATTENTION.map(([label, meta, target, color]) => ({
    label, meta,
    onClick: () => set({ screen: target, workspace: target === 'platform' ? 'platform' : 'tenant' }),
    rowStyle: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', border: '1px solid #eef1f6', borderRadius: '11px', background: '#fbfcfd', cursor: 'pointer', width: '100%' } as CSSProperties,
    dot: { width: '8px', height: '8px', borderRadius: '99px', background: color === ACCENT_DEFAULT ? A : color, flex: '0 0 8px' } as CSSProperties,
  }));

  const orgTeam = ORG_TEAM.map(([name, meta, count]) => ({
    name, meta, count, initials: initials(name),
    chip: { width: '28px', height: '28px', borderRadius: '99px', background: '#e3e7ee', color: '#475569', display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 700, flex: '0 0 28px' } as CSSProperties,
  }));

  const orgBannerStyle: CSSProperties = { background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' };
  const orgAvatar: CSSProperties = { width: '38px', height: '38px', borderRadius: '11px', background: '#0f172a', color: '#f8fafc', display: 'grid', placeItems: 'center', fontSize: '13px', fontWeight: 700, flex: '0 0 38px' };
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);

  const startTour = () => { const st0 = TOUR[0]; set({ tourStep: 0, helpOpen: false, accountOpen: false, workspace: st0.ws, screen: st0.screen }); };
  const goBilling = () => set({ workspace: 'tenant', screen: 'billing' });
  const goInvoices = () => set({ screen: 'invoices' });
  const goBuilder = () => set({ screen: 'builder' });

  return (
    <section data-screen-label="Tenant overview" style={{ padding: '22px 22px 40px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={orgBannerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <span style={orgAvatar}>AC</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.2px' }}>Acme Corporation</span>
            <span style={{ fontSize: '11.5px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>acme · Enterprise · us-east-1 · renews 1 Sep 2026</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flex: '0 0 auto' }}>
          <button type="button" onClick={startTour} style={ghostBtn}>Take the tour</button>
          <button type="button" onClick={goBilling} style={ghostBtn}>Billing &amp; plan</button>
          <button type="button" onClick={goBuilder} style={primaryBtn}>New envelope</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '12px' }}>
        {orgStats.map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '10.5px', letterSpacing: '.06em', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{s.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '25px', fontWeight: 700, letterSpacing: '-.9px' }}>{s.value}</span>
              <span style={s.metaStyle}>{s.meta}</span>
            </div>
            <div style={{ height: '4px', borderRadius: '99px', background: '#eef1f6', overflow: 'hidden' }}><div style={s.bar}></div></div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={railHead}>Envelope volume · last 12 weeks</div>
            <span style={{ fontSize: '11px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>peak 612 / wk</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '130px' }}>
            {orgChart.map((c, i) => (
              <div key={i} style={c.wrap} title={c.title}><div style={c.bar}></div></div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}><span>W23</span><span>W29</span><span>W34</span></div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Needs your attention</div>
          {orgAttention.map(a => (
            <button key={a.label} type="button" onClick={a.onClick} style={a.rowStyle}>
              <span style={a.dot}></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#0f172a' }}>{a.label}</span>
                <span style={{ fontSize: '11px', color: '#64748b' }}>{a.meta}</span>
              </span>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>›</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Spend this cycle</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px' }}>
            <span style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-1px' }}>$38,400</span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>due 1 Sep · autopay on</span>
          </div>
          {ORG_SPEND_LINES.map(l => (
            <div key={l.k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 0', borderTop: '1px solid #f2f4f8' }}>
              <span style={{ color: '#64748b' }}>{l.k}</span><span style={{ fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontWeight: 500 }}>{l.v}</span>
            </div>
          ))}
          <button type="button" onClick={goInvoices} style={ghostBtn}>View invoices</button>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Team activity</div>
          {orgTeam.map(t => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
              <span style={t.chip}>{t.initials}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.meta}</span>
              </div>
              <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", flex: '0 0 auto' }}>{t.count}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
