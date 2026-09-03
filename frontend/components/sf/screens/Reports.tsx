'use client';
/* SignForge — Reports screen (isReports). Markup ported verbatim from the
   prototype template + renderVals(); every figure now comes from
   `GET /api/reports/*` via `app/(app)/reports/page.tsx`. */
import React, { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { SECTION_PARAM, sectionFor } from '@/lib/sf/routes';
import { btn, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { reports as reportsApi } from '@/lib/api/resources';
import {
  REPORT_CARDS,
  reportFieldLabel,
  toCustomReportCells,
  type ReportTableRow,
  type ReportTileRow,
} from '@/lib/sf/adapters';

const th: CSSProperties = { padding:'10px 14px', fontSize:'.6875rem', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
const thRight: CSSProperties = { padding:'10px 14px', fontSize:'.6875rem', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, textAlign:'right', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
const td: CSSProperties = { padding:'11px 14px', verticalAlign:'middle' };
const emptyCell: CSSProperties = { padding:'22px 14px', fontSize:'.78125rem', color:TEXT_MUTED, textAlign:'center' };

const REPORT_RANGES: [string, string][] = [
  ['7d','Last 7 days'], ['30d','Last 30 days'], ['90d','Last quarter'], ['12m','Last 12 months']
];

const REPORT_TITLES: Record<string, string> = {
  analytics:'My Analytics', all:'All reports', documents:'Documents report',
  templates:'Templates report', recipients:'Recipients report', custom:'Custom report'
};
const REPORT_SUBS: Record<string, string> = {
  analytics:'Track and compare performance using metrics like documents sent and completion rate.',
  all:'Every standard report available on your plan.',
  documents:'Status, progress and ageing per envelope.',
  templates:'Template inventory and usage.',
  recipients:'Volume and completion behaviour per recipient.',
  custom:'Compose your own report from available dimensions.'
};

/** Which `report_service.REPORT_KEYS` the "Export report" button downloads. */
const SECTION_REPORT_KEY: Record<string, string> = {
  analytics: 'invites', all: 'documents', documents: 'documents',
  templates: 'templates', recipients: 'recipients', custom: 'documents',
};

/**
 * Server data, fetched and adapted in `app/(app)/reports/page.tsx` (and its
 * platform twin). The screen owns only UI state: the section (in the store,
 * driven by the rail), and the custom-report draft below.
 *
 * The range is NOT store state — it is the `?range=` search param, so a range
 * is shareable and changing it re-runs the server component.
 */
export type ReportsProps = {
  scope: 'tenant' | 'platform';
  /** `7d | 30d | 90d | 12m`, mirrored from `?range=`. */
  range: string;
  inviteTotal: number;
  inviteSplit: [string, number, string][];
  tiles: ReportTileRow[];
  recipientRows: ReportTableRow[];
  recipientTotal: number;
  docRows: ReportTableRow[];
  tplRows: ReportTableRow[];
  /** `GET /api/reports/fields` — the custom-report dimension catalogue. */
  customFields: string[];
  savedReports: { id: string; name: string; fields: string[] }[];
  /** Set when the API cannot answer this screen in the requested scope. */
  scopeNotice: string | null;
};

export default function Reports({
  scope, range, inviteTotal, inviteSplit, tiles, recipientRows, recipientTotal,
  docRows, tplRows, customFields, savedReports, scopeNotice,
}: ReportsProps) {
  const { s, set, flash, accent } = useSF();
  const router = useRouter();
  const pathname = usePathname() || '/reports';
  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  /* The dashboard on screen is the URL, owned by the sidebar — so a report
     view can be linked and shared instead of living in client state. */
  const searchParams = useSearchParams();
  const sec = sectionFor('reports', searchParams.get(SECTION_PARAM));

  /**
   * `GET /api/reports/{key}/csv` is a synchronous CSV; the browser gets it
   * through `/api/proxy` (which re-attaches the bearer token and passes the
   * `text/csv` body straight through) and saves it as a file.
   *
   * The asynchronous path — `POST /api/reports/export` then polling
   * `GET /api/reports/exports/{id}` — exists for scheduled/large exports; the
   * button uses the synchronous one so the file lands immediately.
   */
  const downloadCsv = async (reportKey: string) => {
    flash('Report exported · CSV queued for download');
    try {
      const res = await fetch(`/api/proxy/reports/${encodeURIComponent(reportKey)}/csv?range=${encodeURIComponent(range)}`, {
        headers: { accept: 'text/csv' },
      });
      if (!res.ok) { flash(`Could not export · ${res.status}`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${reportKey}-${range}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      flash('Could not export · the API is unreachable');
    }
  };

  const exportReport = () => { void downloadCsv(SECTION_REPORT_KEY[sec] ?? 'documents'); };

  /* The range lives in the URL, so the server component refetches on change.
     Merged into the existing query rather than replacing it — writing the
     whole string dropped `?section=`, which bounced you back to the default
     dashboard every time you changed the date range. */
  const onReportRange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    set({ reportRange: next });
    const params = new URLSearchParams(searchParams.toString());
    params.set('range', next);
    router.push(pathname + '?' + params.toString());
  };

  const inviteBar = inviteSplit.filter(x => x[1] > 0).map(([label, n, c]) => ({
    label, style: { width: (inviteTotal ? n / inviteTotal * 100 : 0) + '%', background:c, height:'100%' } as CSSProperties
  }));
  const inviteLegend = inviteSplit.map(([label, n, c]) => ({
    label, value: String(n),
    dot: { width:'8px', height:'8px', borderRadius:'99px', background:c, flex:'0 0 8px' } as CSSProperties
  }));

  const withDividers = (rows: ReportTableRow[]) => rows.map((r, i) => ({
    ...r, rowStyle: { borderTop: i ? '1px solid #f2f4f8' : 'none' } as CSSProperties,
  }));
  const recipientTableRows = useMemo(() => withDividers(recipientRows), [recipientRows]);
  const docTableRows = useMemo(() => withDividers(docRows), [docRows]);
  const tplTableRows = useMemo(() => withDividers(tplRows), [tplRows]);

  /* Each "All reports" card is a real report key, so it downloads for real. */
  const allReportCards = REPORT_CARDS.map(card => ({
    label: card.label, meta: card.meta,
    onClick: () => { void downloadCsv(card.key); },
    style: { display:'flex', flexDirection:'column', gap:'5px', alignItems:'flex-start', textAlign:'left', padding:'14px', borderRadius:'13px',
      border:'1px solid #e3e7ee', background:'#fbfcfd', cursor:'pointer' } as CSSProperties
  }));

  /* ── custom report builder ─────────────────────────────────────────────
     The draft resumes the most recently saved definition, so "Run report"
     works on a return visit without re-picking every dimension. */
  const latest = savedReports[0];
  const [definitionId, setDefinitionId] = useState<string | null>(latest?.id ?? null);
  const [picked, setPicked] = useState<string[]>(latest?.fields ?? []);
  const [runFields, setRunFields] = useState<string[]>([]);
  const [runRows, setRunRows] = useState<Record<string, unknown>[]>([]);
  const [busy, setBusy] = useState(false);

  const togglePicked = (field: string) => {
    setDefinitionId(null);          // the saved definition no longer matches
    setPicked(prev => (prev.includes(field) ? prev.filter(f => f !== field) : prev.concat(field)));
  };

  /** Create the definition on first use; `POST /api/reports/custom`. */
  const ensureDefinition = async (): Promise<string | null> => {
    if (definitionId) return definitionId;
    if (!picked.length) { flash('Pick at least one dimension first'); return null; }
    const res = await reportsApi.customCreate(apiCall, {
      name: latest?.name ?? `Custom report · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      fields: picked,
    });
    if (!res.ok) { flash('Could not save · ' + res.error.message); return null; }
    setDefinitionId(res.data.id);
    return res.data.id;
  };

  const runReport = async () => {
    setBusy(true);
    const id = await ensureDefinition();
    if (id) {
      const res = await reportsApi.customRun(apiCall, id);
      if (res.ok) {
        setRunFields(res.data.fields);
        setRunRows(res.data.rows ?? []);
        flash(`${res.data.name} · ${res.data.row_count} rows`);
      } else {
        flash('Could not run · ' + res.error.message);
      }
    }
    setBusy(false);
  };

  const saveDefinition = async () => {
    setBusy(true);
    const id = definitionId
      ? (await reportsApi.customUpdate(apiCall, definitionId, { fields: picked })).ok ? definitionId : null
      : await ensureDefinition();
    if (id) { flash('Definition saved'); router.refresh(); }
    else flash('Could not save the definition');
    setBusy(false);
  };

  const scheduleWeekly = async () => {
    setBusy(true);
    const id = await ensureDefinition();
    if (id) {
      const res = await reportsApi.customSchedule(apiCall, id, { cadence: 'weekly', format: 'csv' });
      flash(res.ok ? 'Scheduled weekly · CSV' : 'Could not schedule · ' + res.error.message);
    }
    setBusy(false);
  };

  const customFieldChips = customFields.map(field => {
    const on = picked.includes(field);
    return {
      field,
      label: reportFieldLabel(field),
      prefix: on ? '−' : '+',
      style: { padding:'5px 10px', borderRadius:'99px', border:'1px solid ' + (on ? A : '#e3e7ee'), background: on ? '#f5f7ff' : '#fff', fontSize:'.71875rem', color: on ? A : '#475569', cursor:'pointer' } as CSSProperties,
      onClick: () => togglePicked(field),
    };
  });

  const rpAnalytics = sec === 'analytics';
  const rpAll = sec === 'all';
  const rpDocuments = sec === 'documents';
  const rpTemplates = sec === 'templates';
  const rpRecipients = sec === 'recipients';
  const rpCustom = sec === 'custom';

  const recipientTable = (
    <div data-sf-scroll="1" style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', minWidth:'900px', borderCollapse:'collapse', fontSize:'.78125rem' }}>
        <thead>
          <tr style={{ textAlign:'left', color:'#64748b' }}>
            <th scope="col" style={th}>Recipient</th>
            <th scope="col" style={th}>Created</th>
            <th scope="col" style={th}>Sent</th>
            <th scope="col" style={th}>Pending</th>
            <th scope="col" style={th}>Completed</th>
            <th scope="col" style={th}>Cancelled</th>
            <th scope="col" style={th}>Declined</th>
            <th scope="col" style={th}>Completion time</th>
            <th scope="col" style={thRight}>Rate</th>
          </tr>
        </thead>
        <tbody>
          {recipientTableRows.length === 0 ? (
            <tr><td colSpan={9} style={emptyCell}>No invites went out in this period.</td></tr>
          ) : recipientTableRows.map(r => (
            <tr key={r.key} style={r.rowStyle}>
              <td style={td}><span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.label}</span></td>
              {r.cells.map((c, ci) => <td key={ci} style={td}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section data-screen-label="Reports" style={{ display:'flex', minHeight:'100%', alignItems:'stretch' }}>
      <div style={{ flex:1, minWidth:0, padding:'20px', display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
            <h2 style={{ margin:0, fontSize:'1.1875rem', fontWeight:700, letterSpacing:'-.4px' }}>{REPORT_TITLES[sec]}</h2>
            <span style={{ fontSize:'.78125rem', color:'#64748b', lineHeight:1.5, maxWidth:'560px' }}>{REPORT_SUBS[sec]}</span>
          </div>
          <div style={{ display:'flex', gap:'7px', flex:'0 0 auto', alignItems:'center' }}>
            <select
              value={range}
              onChange={onReportRange}
              aria-label="Date range"
              style={{ height:'32px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 10px', fontSize:'.78125rem', background:'#fff', color:'#334155', outline:'none' }}
            >
              {REPORT_RANGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button type="button" onClick={exportReport} style={ghostBtn}>Export report</button>
          </div>
        </div>

        {scopeNotice ? (
          <div
            data-sf-scope={scope}
            style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:'13px', padding:'12px 14px', fontSize:'.75rem', color:'#c2410c', lineHeight:1.6 }}
          >
            {scopeNotice}
          </div>
        ) : null}

        {rpAnalytics ? (
          <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <span style={railHead}>Total sent invites</span>
              <span style={{ fontSize:'2.125rem', fontWeight:700, letterSpacing:'-1.4px', lineHeight:1 }}>{String(inviteTotal)}</span>
              <div style={{ display:'flex', height:'8px', borderRadius:'99px', overflow:'hidden', background:'#eef1f6' }}>
                {inviteBar.map(b => <span key={b.label} style={b.style} />)}
              </div>
              <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
                {inviteLegend.map(l => (
                  <span key={l.label} style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'.75rem', color:'#475569' }}>
                    <span style={l.dot} />{l.label} <strong style={{ color:'#0f172a' }}>{l.value}</strong>
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:'12px' }}>
              {tiles.map(t => (
                <div key={t.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'6px' }}>
                  <span style={{ fontSize:'.65625rem', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{t.label}</span>
                  <span style={{ fontSize:'1.3125rem', fontWeight:700, letterSpacing:'-.7px' }}>{t.value}</span>
                  <span style={{ fontSize:'.6875rem', color:TEXT_MUTED }}>{t.meta}</span>
                </div>
              ))}
            </div>

            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
              <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
                <span style={{ fontSize:'.84375rem', fontWeight:600 }}>Recipients who received invites</span>
                <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{recipientTotal} recipients</span>
              </div>
              {recipientTable}
            </div>
          </div>
        ) : null}

        {rpAll ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'12px' }}>
            {allReportCards.map(c => (
              <button key={c.label} type="button" onClick={c.onClick} style={c.style}>
                <span style={{ fontSize:'.8125rem', fontWeight:600, color:'#0f172a' }}>{c.label}</span>
                <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.5 }}>{c.meta}</span>
              </button>
            ))}
          </div>
        ) : null}

        {rpDocuments ? (
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
            <div data-sf-scroll="1" style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'760px', borderCollapse:'collapse', fontSize:'.78125rem' }}>
                <thead>
                  <tr style={{ textAlign:'left', color:'#64748b' }}>
                    <th scope="col" style={th}>Document</th>
                    <th scope="col" style={th}>Recipients</th>
                    <th scope="col" style={th}>Signed</th>
                    <th scope="col" style={th}>Status</th>
                    <th scope="col" style={th}>Updated</th>
                    <th scope="col" style={thRight}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {docTableRows.length === 0 ? (
                    <tr><td colSpan={6} style={emptyCell}>No envelopes were created in this period.</td></tr>
                  ) : docTableRows.map(r => (
                    <tr key={r.key} style={r.rowStyle}>
                      <td style={td}>
                        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                          <span style={{ fontWeight:600 }}>{r.label}</span>
                          <span style={{ fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.sub}</span>
                        </div>
                      </td>
                      {r.cells.map((c, ci) => <td key={ci} style={td}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {rpTemplates ? (
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
            <div data-sf-scroll="1" style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'660px', borderCollapse:'collapse', fontSize:'.78125rem' }}>
                <thead>
                  <tr style={{ textAlign:'left', color:'#64748b' }}>
                    <th scope="col" style={th}>Template</th>
                    <th scope="col" style={th}>Uses</th>
                    <th scope="col" style={th}>Fields</th>
                    <th scope="col" style={th}>Owner</th>
                    <th scope="col" style={thRight}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {tplTableRows.length === 0 ? (
                    <tr><td colSpan={5} style={emptyCell}>No templates were created in this period.</td></tr>
                  ) : tplTableRows.map(r => (
                    <tr key={r.key} style={r.rowStyle}>
                      <td style={td}>
                        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                          <span style={{ fontWeight:600 }}>{r.label}</span>
                          <span style={{ fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.sub}</span>
                        </div>
                      </td>
                      {r.cells.map((c, ci) => <td key={ci} style={td}>{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {rpRecipients ? (
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
            {recipientTable}
          </div>
        ) : null}

        {rpCustom ? (
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
            <span style={railHead}>Available dimensions</span>
            <div style={{ display:'flex', gap:'7px', flexWrap:'wrap' }}>
              {customFieldChips.map(f => (
                <button key={f.field} type="button" onClick={f.onClick} style={f.style}>{f.prefix} {f.label}</button>
              ))}
            </div>
            {picked.length === 0 ? (
              <div style={{ border:'1px dashed #8492a6', borderRadius:'13px', padding:'28px', textAlign:'center', color:TEXT_MUTED, fontSize:'.78125rem', lineHeight:1.6 }}>
                Drop dimensions here to compose a report.<br />Group by any field, then save the definition or schedule a recurring export.
              </div>
            ) : (
              <div style={{ border:'1px dashed #8492a6', borderRadius:'13px', padding:'14px', display:'flex', gap:'7px', flexWrap:'wrap' }}>
                {picked.map(field => (
                  <span key={field} style={{ padding:'5px 10px', borderRadius:'99px', border:'1px solid ' + A, background:'#f5f7ff', fontSize:'.71875rem', color:A }}>{reportFieldLabel(field)}</span>
                ))}
              </div>
            )}
            <div style={{ display:'flex', gap:'8px' }}>
              <button type="button" onClick={() => { void runReport(); }} disabled={busy} style={primaryBtn}>Run report</button>
              <button type="button" onClick={() => { void saveDefinition(); }} disabled={busy} style={ghostBtn}>Save definition</button>
              <button type="button" onClick={() => { void scheduleWeekly(); }} disabled={busy} style={ghostBtn}>Schedule weekly</button>
            </div>

            {runFields.length ? (
              <div data-sf-scroll="1" style={{ overflowX:'auto', border:'1px solid #eef1f6', borderRadius:'13px' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'.78125rem' }}>
                  <thead>
                    <tr style={{ textAlign:'left', color:'#64748b' }}>
                      {runFields.map(field => <th key={field} scope="col" style={th}>{reportFieldLabel(field)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {runRows.length === 0 ? (
                      <tr><td colSpan={runFields.length} style={emptyCell}>No rows matched this definition.</td></tr>
                    ) : runRows.map((row, ri) => (
                      <tr key={ri} style={{ borderTop: ri ? '1px solid #f2f4f8' : '1px solid #eef1f6' }}>
                        {toCustomReportCells(row, runFields).map((cell, ci) => <td key={ci} style={td}>{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
