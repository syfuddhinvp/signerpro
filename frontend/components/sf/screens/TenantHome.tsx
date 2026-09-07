'use client';

import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import type { ScreenKey } from '@/lib/sf/routes';
import { tourSteps } from '@/lib/sf/data';
import { useOptionalSession } from '@/components/sf/SessionProvider';
import { btn, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import type {
  OverviewAttentionRow,
  OverviewBanner,
  OverviewSpend,
  OverviewTeamRow,
} from '@/lib/sf/adapters';

/**
 * Server data, fetched and adapted in `app/(app)/overview/page.tsx` from
 * `GET /api/organizations/me/overview`. This screen owns no data of its own —
 * only the tour trigger and navigation.
 */
export type TenantHomeProps = {
  banner: OverviewBanner;
  stats: { label: string; value: string; meta: string; good: boolean; pct: number }[];
  /** Twelve envelope counts, one per bucket of the overview's range. */
  series: number[];
  /** Bucket labels (`W23`…) for the chart's tooltips and axis. */
  seriesLabels: string[];
  attention: OverviewAttentionRow[];
  spend: OverviewSpend;
  team: OverviewTeamRow[];
  /** "due 1 Sep · autopay on", from the subscription. */
  nextInvoiceMeta: string;
};

/* Shared with the empty branches so they match the design's muted rows. */
const emptyNote: CSSProperties = { fontSize: '.75rem', color: TEXT_MUTED, lineHeight: 1.6 };

export default function TenantHome({
  banner, stats, series, seriesLabels, attention, spend, team, nextInvoiceMeta,
}: TenantHomeProps) {
  const { set, initials, accent } = useSF();
  const session = useOptionalSession();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();

  const orgStats = stats.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize: '.71875rem', fontWeight: 600, fontFamily: 'var(--font-sans)', color: x.good ? '#047857' : '#c2410c' } as CSSProperties,
    bar: { width: x.pct + '%', height: '100%', borderRadius: '99px', background: x.good ? '#10b981' : '#f59e0b' } as CSSProperties,
  }));

  /* The prototype divided by a hardcoded 612; the peak is now the real one. */
  const peak = Math.max(1, ...series);
  const orgChart = series.map((v, i) => ({
    title: (seriesLabels[i] ?? `Bucket ${i + 1}`) + ' · ' + v + ' envelopes',
    wrap: { flex: '1', height: '100%', display: 'flex', alignItems: 'flex-end' } as CSSProperties,
    bar: { width: '100%', height: Math.round(v / peak * 100) + '%', borderRadius: '5px 5px 2px 2px', background: i === series.length - 1 ? A : '#c7d2fe' } as CSSProperties,
  }));
  const axis = [seriesLabels[0], seriesLabels[Math.floor(series.length / 2)], seriesLabels[series.length - 1]];

  const orgAttention = attention.map(a => ({
    label: a.label, meta: a.meta,
    onClick: () => router.push(a.href),
    rowStyle: { display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 10px', border: '1px solid #eef1f6', borderRadius: '11px', background: '#fbfcfd', cursor: 'pointer', width: '100%' } as CSSProperties,
    dot: { width: '8px', height: '8px', borderRadius: '99px', background: a.color === 'ACCENT' ? A : a.color, flex: '0 0 8px' } as CSSProperties,
  }));

  const orgTeam = team.map(t => ({
    name: t.name, meta: t.meta, count: t.count, initials: initials(t.name),
    chip: { width: '28px', height: '28px', borderRadius: '99px', background: '#e3e7ee', color: '#475569', display: 'grid', placeItems: 'center', fontSize: '.6875rem', fontWeight: 700, flex: '0 0 28px' } as CSSProperties,
  }));

  const orgBannerStyle: CSSProperties = { background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' };
  const orgAvatar: CSSProperties = { width: '38px', height: '38px', borderRadius: '11px', background: '#0f172a', color: '#f8fafc', display: 'grid', placeItems: 'center', fontSize: '.8125rem', fontWeight: 700, flex: '0 0 38px' };
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);

  const startTour = () => { const st0 = tourSteps(session?.isPlatformAdmin === true, session?.role)[0]; set({ tourStep: 0, helpOpen: false }); go(st0.screen as ScreenKey, { workspace: st0.ws }); };
  const goBilling = () => go('billing', { workspace: 'tenant' });
  const goInvoices = () => go('invoices');
  const goBuilder = () => go('builder');

  return (
    <section data-screen-label="Tenant overview" style={{ padding: '22px 22px 40px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={orgBannerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <span style={orgAvatar}>{banner.initials}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>{banner.name}</span>
            <span style={{ fontSize: '.71875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>{banner.meta}</span>
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
            <span style={{ fontSize: '.65625rem', letterSpacing: '.06em', color: '#64748b', fontFamily: 'var(--font-sans)' }}>{s.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '1.5625rem', fontWeight: 700, letterSpacing: '-.9px' }}>{s.value}</span>
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
            <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>peak {peak} / wk</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '130px' }}>
            {orgChart.map((c, i) => (
              <div key={i} style={c.wrap} title={c.title}><div style={c.bar}></div></div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.65625rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>{axis.map((label, i) => <span key={i}>{label}</span>)}</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Needs your attention</div>
          {orgAttention.length === 0 ? (
            <span style={emptyNote}>Nothing needs a decision right now.</span>
          ) : orgAttention.map(a => (
            <button key={a.label} type="button" onClick={a.onClick} style={a.rowStyle}>
              <span style={a.dot}></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '.78125rem', fontWeight: 600, color: '#0f172a' }}>{a.label}</span>
                <span style={{ fontSize: '.6875rem', color: '#64748b' }}>{a.meta}</span>
              </span>
              <span style={{ fontSize: '.75rem', color: TEXT_MUTED }}>›</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Spend this cycle</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px' }}>
            <span style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-1px' }}>{spend.total}</span>
            <span style={{ fontSize: '.75rem', color: '#64748b' }}>{nextInvoiceMeta}</span>
          </div>
          {spend.lines.length === 0 ? (
            <span style={emptyNote}>No invoiced usage in this period yet.</span>
          ) : spend.lines.map(l => (
            <div key={l.k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', padding: '6px 0', borderTop: '1px solid #f2f4f8' }}>
              <span style={{ color: '#64748b' }}>{l.k}</span><span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500 }}>{l.v}</span>
            </div>
          ))}
          <button type="button" onClick={goInvoices} style={ghostBtn}>View invoices</button>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Team activity</div>
          {orgTeam.length === 0 ? (
            <span style={emptyNote}>No teammates have sent an envelope yet.</span>
          ) : orgTeam.map(t => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
              <span style={t.chip}>{t.initials}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '.78125rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                <span style={{ fontSize: '.6875rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.meta}</span>
              </div>
              <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)', flex: '0 0 auto' }}>{t.count}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
