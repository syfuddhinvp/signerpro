'use client';
/* SignForge — Reports screen (isReports). Ported verbatim from the prototype template + renderVals(). */
import React, { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { DOCS, REPORT_RECIPIENTS, STATUS, TEMPLATES } from '@/lib/sf/data';
import { btn, railHead } from '@/lib/sf/ui';

const th: CSSProperties = { padding:'10px 14px', fontSize:'11px', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
const thRight: CSSProperties = { padding:'10px 14px', fontSize:'11px', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, textAlign:'right', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
const td: CSSProperties = { padding:'11px 14px', verticalAlign:'middle' };

const INVITE_SPLIT: [string, number, string][] = [
  ['Pending / expired', 1, '#f59e0b'],
  ['Completed', 9, '#10b981'],
  ['Declined', 0, '#f43f5e'],
  ['Cancelled', 5, '#facc15']
];

const REPORT_TILES = [
  { label:'COMPLETION RATE', value:'60%', meta:'9 of 15 invites' },
  { label:'MEDIAN COMPLETION', value:'2h 14m', meta:'−18% vs prior period' },
  { label:'TEMPLATES CREATED', value:'7', meta:'128 uses' },
  { label:'DOCUMENTS CREATED', value:'18', meta:'6 senders' },
  { label:'RECIPIENTS', value:'6', meta:'2 first-time' }
];

const REPORT_RANGES: [string, string][] = [
  ['7d','Last 7 days'], ['30d','Last 30 days'], ['90d','Last quarter'], ['12m','Last 12 months']
];

const ALL_REPORT_CARDS: [string, string][] = [
  ['Documents report', 'Status, progress and ageing for every envelope in the period.'],
  ['Templates report', 'Template inventory with field counts and owners.'],
  ['Templates usage report', 'Which templates are used, by whom and how often.'],
  ['Completed copies report', 'Every completed copy generated from a template.'],
  ['Recipients report', 'Per-recipient volume, completion time and decline rate.'],
  ['Audit export', 'Full event log with checksums for a date range.']
];

const CUSTOM_REPORT_FIELDS = ['Envelope status','Recipient','Sender','Template','Completion time','Field values','Tenant','Tags'];

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

export default function Reports() {
  const { s, set, flash, accent } = useSF();
  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const exportReport = () => flash('Report exported · CSV queued for download');
  const onReportRange = (e: React.ChangeEvent<HTMLSelectElement>) => set({ reportRange: e.target.value });

  const inviteTotal = INVITE_SPLIT.reduce((a, x) => a + x[1], 0);
  const inviteBar = INVITE_SPLIT.filter(x => x[1] > 0).map(([label, n, c]) => ({
    label, style: { width: (n / inviteTotal * 100) + '%', background:c, height:'100%' } as CSSProperties
  }));
  const inviteLegend = INVITE_SPLIT.map(([label, n, c]) => ({
    label, value: String(n),
    dot: { width:'8px', height:'8px', borderRadius:'99px', background:c, flex:'0 0 8px' } as CSSProperties
  }));

  const recipientRows = useMemo(() => REPORT_RECIPIENTS.map((r: any, i: number) => ({
    email: String(r[0]),
    cells: [r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]].map(v => ({ v: String(v) })),
    rowStyle: { borderTop: i ? '1px solid #f2f4f8' : 'none' } as CSSProperties
  })), []);

  const docReportRows = useMemo(() => DOCS.slice(0, 6).map((d: any, i: number) => ({
    title: d.title, id: d.id,
    cells: [
      { v: String(d.total) }, { v: String(d.signed) }, { v: STATUS[d.status].label },
      { v: d.updated }, { v: Math.round(d.signed / d.total * 100) + '%' }
    ],
    rowStyle: { borderTop: i ? '1px solid #f2f4f8' : 'none' } as CSSProperties
  })), []);

  const tplReportRows = useMemo(() => TEMPLATES.map((t: any, i: number) => ({
    title: t.title, id: t.id,
    cells: [{ v: String(t.uses) }, { v: String(t.fields) }, { v: t.owner }, { v: t.updated }],
    rowStyle: { borderTop: i ? '1px solid #f2f4f8' : 'none' } as CSSProperties
  })), []);

  const allReportCards = ALL_REPORT_CARDS.map(([label, meta]) => ({
    label, meta,
    onClick: () => flash(label + ' generated · ready to export'),
    style: { display:'flex', flexDirection:'column', gap:'5px', alignItems:'flex-start', textAlign:'left', padding:'14px', borderRadius:'13px',
      border:'1px solid #e3e7ee', background:'#fbfcfd', cursor:'pointer' } as CSSProperties
  }));

  const customFields = CUSTOM_REPORT_FIELDS.map(label => ({
    label,
    style: { padding:'5px 10px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fff', fontSize:'11.5px', color:'#475569', cursor:'pointer' } as CSSProperties,
    onClick: () => flash(label + ' added to the custom report')
  }));

  const sec = s.reportsSection;
  const rpAnalytics = sec === 'analytics';
  const rpAll = sec === 'all';
  const rpDocuments = sec === 'documents';
  const rpTemplates = sec === 'templates';
  const rpRecipients = sec === 'recipients';
  const rpCustom = sec === 'custom';

  const recipientTable = (
    <div data-sf-scroll="1" style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', minWidth:'900px', borderCollapse:'collapse', fontSize:'12.5px' }}>
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
          {recipientRows.map(r => (
            <tr key={r.email} style={r.rowStyle}>
              <td style={td}><span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.email}</span></td>
              {r.cells.map((c, ci) => <td key={ci} style={td}>{c.v}</td>)}
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
            <h2 style={{ margin:0, fontSize:'19px', fontWeight:700, letterSpacing:'-.4px' }}>{REPORT_TITLES[sec]}</h2>
            <span style={{ fontSize:'12.5px', color:'#64748b', lineHeight:1.5, maxWidth:'560px' }}>{REPORT_SUBS[sec]}</span>
          </div>
          <div style={{ display:'flex', gap:'7px', flex:'0 0 auto', alignItems:'center' }}>
            <select
              value={s.reportRange}
              onChange={onReportRange}
              aria-label="Date range"
              style={{ height:'32px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 10px', fontSize:'12.5px', background:'#fff', color:'#334155', outline:'none' }}
            >
              {REPORT_RANGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button type="button" onClick={exportReport} style={ghostBtn}>Export report</button>
          </div>
        </div>

        {rpAnalytics ? (
          <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <span style={railHead}>Total sent invites</span>
              <span style={{ fontSize:'34px', fontWeight:700, letterSpacing:'-1.4px', lineHeight:1 }}>{String(inviteTotal)}</span>
              <div style={{ display:'flex', height:'8px', borderRadius:'99px', overflow:'hidden', background:'#eef1f6' }}>
                {inviteBar.map(b => <span key={b.label} style={b.style} />)}
              </div>
              <div style={{ display:'flex', gap:'16px', flexWrap:'wrap' }}>
                {inviteLegend.map(l => (
                  <span key={l.label} style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'12px', color:'#475569' }}>
                    <span style={l.dot} />{l.label} <strong style={{ color:'#0f172a' }}>{l.value}</strong>
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:'12px' }}>
              {REPORT_TILES.map(t => (
                <div key={t.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'6px' }}>
                  <span style={{ fontSize:'10.5px', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{t.label}</span>
                  <span style={{ fontSize:'21px', fontWeight:700, letterSpacing:'-.7px' }}>{t.value}</span>
                  <span style={{ fontSize:'11px', color:'#94a3b8' }}>{t.meta}</span>
                </div>
              ))}
            </div>

            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
              <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
                <span style={{ fontSize:'13.5px', fontWeight:600 }}>Recipients who received invites</span>
                <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>7 recipients</span>
              </div>
              {recipientTable}
            </div>
          </div>
        ) : null}

        {rpAll ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'12px' }}>
            {allReportCards.map(c => (
              <button key={c.label} type="button" onClick={c.onClick} style={c.style}>
                <span style={{ fontSize:'13px', fontWeight:600, color:'#0f172a' }}>{c.label}</span>
                <span style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.5 }}>{c.meta}</span>
              </button>
            ))}
          </div>
        ) : null}

        {rpDocuments ? (
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
            <div data-sf-scroll="1" style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', minWidth:'760px', borderCollapse:'collapse', fontSize:'12.5px' }}>
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
                  {docReportRows.map(r => (
                    <tr key={r.id} style={r.rowStyle}>
                      <td style={td}>
                        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                          <span style={{ fontWeight:600 }}>{r.title}</span>
                          <span style={{ fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.id}</span>
                        </div>
                      </td>
                      {r.cells.map((c, ci) => <td key={ci} style={td}>{c.v}</td>)}
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
              <table style={{ width:'100%', minWidth:'660px', borderCollapse:'collapse', fontSize:'12.5px' }}>
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
                  {tplReportRows.map(r => (
                    <tr key={r.id} style={r.rowStyle}>
                      <td style={td}>
                        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                          <span style={{ fontWeight:600 }}>{r.title}</span>
                          <span style={{ fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.id}</span>
                        </div>
                      </td>
                      {r.cells.map((c, ci) => <td key={ci} style={td}>{c.v}</td>)}
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
              {customFields.map(f => (
                <button key={f.label} type="button" onClick={f.onClick} style={f.style}>+ {f.label}</button>
              ))}
            </div>
            <div style={{ border:'1px dashed #cbd5e1', borderRadius:'13px', padding:'28px', textAlign:'center', color:'#94a3b8', fontSize:'12.5px', lineHeight:1.6 }}>
              Drop dimensions here to compose a report.<br />Group by any field, then save the definition or schedule a recurring export.
            </div>
            <div style={{ display:'flex', gap:'8px' }}>
              <button type="button" onClick={exportReport} style={primaryBtn}>Run report</button>
              <button type="button" onClick={exportReport} style={ghostBtn}>Save definition</button>
              <button type="button" onClick={exportReport} style={ghostBtn}>Schedule weekly</button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
