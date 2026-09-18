'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import type { ScreenKey } from '@/lib/sf/routes';
import { tourSteps } from '@/lib/sf/data';
import { useOptionalSession } from '@/components/sf/SessionProvider';
import { btn, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import { folderHref } from '@/lib/sf/navigation';
import { apiCall } from '@/lib/api/browser';
import { templates as templatesApi } from '@/lib/api/resources';
import Icon from '@/components/sf/Icon';
import type {
  OverviewAttentionRow,
  OverviewBanner,
  OverviewSpend,
  OverviewTeamRow,
  TemplateCard,
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
  /** Most-used templates, for the "Start from a template" strip. Empty when
   *  the organization has none, or when the template call failed. */
  templates?: TemplateCard[];
};

/* Shared with the empty branches so they match the design's muted rows. */
const emptyNote: CSSProperties = { fontSize: '.75rem', color: TEXT_MUTED, lineHeight: 1.6 };

/* ── "Start from a template" card ──────────────────────────────────────── */
const templateCard: CSSProperties = { border: '1px solid #e3e7ee', borderRadius: '13px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '9px', background: '#fff' };
const templateOpen: CSSProperties = { display: 'flex', flexDirection: 'column', gap: '9px', background: 'none', border: 0, padding: 0, cursor: 'pointer', width: '100%', alignItems: 'stretch' };
const templateTitle: CSSProperties = { fontSize: '.78125rem', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
/** The preview well the mini sheets sit in — a page's 4:3 crop, not a full A4. */
const previewSheet: CSSProperties = { position: 'relative', display: 'block', height: '86px', borderRadius: '9px', background: '#f5f7fa', border: '1px solid #eef1f6', overflow: 'hidden' };
/** The offset sheet behind, shown only for a multi-page template. */
const sheetBack: CSSProperties = { position: 'absolute', width: '58%', height: '78%', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '4px' };
const sheetFace: CSSProperties = { position: 'absolute', left: '12%', top: '8%', width: '60%', height: '84%', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '4px', padding: '7px 6px', display: 'flex', flexDirection: 'column', gap: '4px' };
const sheetLine: CSSProperties = { height: '3px', borderRadius: '99px', background: '#e3e7ee' };
const fieldChip: CSSProperties = { width: '16px', height: '7px', borderRadius: '2px' };
const templateMenu: CSSProperties = { position: 'absolute', right: 0, top: '32px', zIndex: 20, background: '#fff', border: '1px solid #e3e7ee', borderRadius: '10px', padding: '5px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '160px', boxShadow: '0 10px 28px rgba(15,23,42,.13)' };
const menuItem: CSSProperties = { display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 9px', border: 0, borderRadius: '7px', background: 'none', color: '#0f172a', fontSize: '.75rem', fontWeight: 500, cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap' };

export default function TenantHome({
  banner, stats, series, seriesLabels, attention, spend, team, nextInvoiceMeta,
  templates = [],
}: TenantHomeProps) {
  const { set, flash, initials, accent } = useSF();
  const session = useOptionalSession();
  /** The template card whose "…" menu is open, if any. */
  const [menuTemplate, setMenuTemplate] = useState<string | null>(null);
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

  /* A template is a blueprint: using one mints a *new* document and the
     builder opens that, so the template itself is never edited by accident.
     Same call the library's "Use template" row action makes. */
  const useTemplate = (t: TemplateCard) => {
    setMenuTemplate(null);
    flash('Starting from ' + t.title + '…');
    void templatesApi.use(apiCall, t.templateId).then(res => {
      if (!res.ok) { flash('Could not open ' + t.title + ' · ' + res.error.message); return; }
      set({ wizardStep: 1 });
      go('builder', { documentId: res.data.id });
    });
  };

  /* The menu's second door: edit the blueprint itself rather than use it. */
  const editTemplate = (t: TemplateCard) => {
    setMenuTemplate(null);
    set({ wizardStep: 1 });
    go('builder', { documentId: t.templateId });
  };

  const duplicateTemplate = (t: TemplateCard) => {
    setMenuTemplate(null);
    void templatesApi.duplicate(apiCall, t.templateId).then(res => {
      flash(res.ok ? t.title + ' duplicated' : 'Could not duplicate · ' + res.error.message);
      if (res.ok) router.refresh();
    });
  };

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
          <button type="button" onClick={startTour} style={ghostBtn}><Icon name="play" size={13} />Take the tour</button>
          <button type="button" onClick={goBilling} style={ghostBtn}><Icon name="card" size={13} />Billing &amp; plan</button>
          <button type="button" onClick={goBuilder} style={primaryBtn}><Icon name="plus" size={13} />New envelope</button>
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

      <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={railHead}>Start from a template</div>
          <Link href={folderHref('templates')} style={{ fontSize: '.71875rem', color: '#4f46e5', fontWeight: 600, textDecoration: 'none' }}>
            Browse all templates ›
          </Link>
        </div>
        {templates.length === 0 ? (
          <span style={emptyNote}>
            No templates yet. Prepare a document, then save it as a template — or import a ready-made form from the catalog.
          </span>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            {templates.map(t => (
              <div key={t.templateId} style={templateCard}>
                {/* One click on the card starts an envelope from the template. */}
                <button type="button" onClick={() => useTemplate(t)} title={'Start an envelope from ' + t.title} style={templateOpen}>
                  <span style={previewSheet}>
                    {/* A sketch of the form, drawn from its own shape — no
                        thumbnail endpoint serves a real page image. */}
                    {t.pages > 1 ? <span style={{ ...sheetBack, right: '-4px', top: '4px' }} /> : null}
                    <span style={sheetFace}>
                      {[0, 1, 2, 3].map(i => (
                        <span key={i} style={{ ...sheetLine, width: [88, 70, 80, 54][i] + '%' }} />
                      ))}
                      <span style={{ display: 'flex', gap: '4px', marginTop: 'auto' }}>
                        {Array.from({ length: Math.min(Math.max(t.fields, 1), 3) }).map((_, i) => (
                          <span key={i} style={{ ...fieldChip, background: i === 0 ? A : '#c7d2fe' }} />
                        ))}
                      </span>
                    </span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', textAlign: 'left', minWidth: 0, width: '100%' }}>
                    <span style={templateTitle}>{t.title}</span>
                    <span style={{ fontSize: '.65625rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>{t.meta}</span>
                  </span>
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button type="button" onClick={() => useTemplate(t)} style={{ ...primaryBtn, height: '28px', flex: 1, justifyContent: 'center' }}>
                    <Icon name="send" size={12} />Use
                  </button>
                  <div style={{ position: 'relative', flex: '0 0 auto' }}>
                    <button
                      type="button"
                      aria-label={'More actions for ' + t.title}
                      aria-expanded={menuTemplate === t.templateId}
                      onClick={() => setMenuTemplate(menuTemplate === t.templateId ? null : t.templateId)}
                      style={{ ...ghostBtn, height: '28px', padding: '0 8px' }}
                    ><Icon name="caretDown" size={12} /></button>
                    {menuTemplate === t.templateId ? (
                      <div role="menu" style={templateMenu}>
                        <button type="button" role="menuitem" onClick={() => editTemplate(t)} style={menuItem}>
                          <Icon name="pencil" size={12} />Edit the template
                        </button>
                        <button type="button" role="menuitem" onClick={() => duplicateTemplate(t)} style={menuItem}>
                          <Icon name="duplicate" size={12} />Duplicate
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
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
          <button type="button" onClick={goInvoices} style={ghostBtn}><Icon name="file" size={13} />View invoices</button>
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
