'use client';
/* SignForge — PREPARE / BUILDER screen (isBuilder), ported verbatim from the prototype. */
import React, { type CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { TYPES } from '@/lib/sf/data';
import { btn, inputStyle, lbl, railHead, linkBtn } from '@/lib/sf/ui';
import { useBuilderInteractions } from '@/lib/sf/builderInteractions';

const ROLE_LABEL: { [k: string]: string } = { sign:'Needs to sign', approve:'Approver', copy:'Receives a copy', inperson:'In-person signer' };
const REGEX_MAP: { [k: string]: string } = {
  none:'— no pattern enforced —',
  email:'^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$',
  date:'^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$',
  numeric:'^-?\\d+(\\.\\d+)?$',
  custom:'^[A-Z]{3}-\\d{4}$'
};
const COND_OP_LABEL: { [k: string]: string } = { checked:'is checked', equals:'equals', notEmpty:'is not empty' };

export default function Builder() {
  const { s, set, flash, accent, recips, recip, meta, initials, sel, setField, reorder } = useSF();
  const A = accent();
  const I = useBuilderInteractions();

  /* ── wizard ── */
  const wizardStepStyle1: CSSProperties = { display:'flex', alignItems:'center', gap:'7px', fontSize:'12px', fontWeight: s.wizardStep === 1 ? 600 : 500, color: s.wizardStep === 1 ? '#0f172a' : '#94a3b8', background:'none', border:'none', cursor:'pointer' };
  const wizardStepStyle2: CSSProperties = { display:'flex', alignItems:'center', gap:'7px', fontSize:'12px', fontWeight: s.wizardStep === 2 ? 600 : 500, color: s.wizardStep === 2 ? '#0f172a' : '#94a3b8', background:'none', border:'none', cursor:'pointer' };
  const wizardDot1: CSSProperties = { width:'11px', height:'11px', borderRadius:'99px', border:'2px solid ' + (s.wizardStep === 1 ? A : '#cbd5e1'), background: s.wizardStep === 1 ? A : '#fff' };
  const wizardDot2: CSSProperties = { width:'11px', height:'11px', borderRadius:'99px', border:'2px solid ' + (s.wizardStep === 2 ? A : '#cbd5e1'), background: s.wizardStep === 2 ? A : '#fff' };
  const wizardLine: CSSProperties = { width:'52px', height:'2px', background:'#e3e7ee' };
  const wizardCta = s.wizardStep === 1 ? 'Continue' : 'Send envelope';
  const goStep1 = () => set({ wizardStep: 1 });
  const goStep2 = () => set({ wizardStep: 2 });
  const wizardNext = () => { if (s.wizardStep === 1) set({ wizardStep: 2 }); else set({ modal: 'send' }); };
  const saveClose = () => { set({ screen: 'dashboard' }); flash('Draft saved · returned to documents'); };
  const prepareRowStyle: CSSProperties = { flex:'1', minHeight:0, display: s.wizardStep === 1 ? 'flex' : 'none' };

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);
  const chipBtn = btn('#fff', '#475569', '#e3e7ee');
  const alignStyle = btn('#fff', '#475569', '#e3e7ee');
  const dangerStyle = btn('#fff', '#b91c1c', '#fecaca');
  const gridBtnStyle = btn(s.grid ? '#eef2ff' : '#fff', s.grid ? '#3730a3' : '#475569', s.grid ? '#c7d2fe' : '#e3e7ee');
  const iconBtn: CSSProperties = { width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'13px', lineHeight:1 };
  const input = inputStyle;
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11.5px' });
  const textareaStyle: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'9px', padding:'8px 10px', fontSize:'12.5px', resize:'vertical', outline:'none', width:'100%', color:'#0f172a' };

  /* ── recipient cards ── */
  const recipientCards = recips().map(r => {
    const on = s.activeRecipient === r.id;
    return {
      id: r.id,
      name: r.name, order: String(r.order), fieldCount: String(s.fields.filter(f => f.to === r.id).length), state: r.status,
      role: ROLE_LABEL[r.role],
      onClick: () => set({ activeRecipient: r.id }),
      style: { display:'flex', alignItems:'center', gap:'9px', padding:'9px', borderRadius:'11px', cursor:'pointer',
        border:'1px solid ' + (on ? r.color : '#e3e7ee'), background: on ? r.color + '14' : '#fff', width:'100%' } as CSSProperties,
      chip: { width:'26px', height:'26px', borderRadius:'8px', background:r.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'11px', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
      stateStyle: { marginLeft:'auto', fontSize:'10px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#64748b', whiteSpace:'nowrap' } as CSSProperties
    };
  });

  /* ── palette ── */
  const paletteTabs = ([['all','All fields'],['fav','Favourites']] as [string, string][]).map(([id, label]) => {
    const on = s.paletteTab === id;
    return { id, label, selected: on,
      onClick: () => set({ paletteTab: id }),
      style: { flex:'1', height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'11.5px', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });
  const tools = TYPES.filter(t => (s.paletteTab === 'all' || s.favTypes.indexOf(t.id) > -1) &&
      (!s.paletteQuery || t.label.toLowerCase().indexOf(s.paletteQuery.toLowerCase()) > -1)).map(t => ({
    id: t.id, label: t.label, icon: t.icon, aria: 'Drag to place ' + t.label,
    onDown: (e: React.PointerEvent) => I.onToolDown(t.id, e),
    style: { display:'flex', alignItems:'center', gap:'7px', padding:'8px 9px', borderRadius:'10px', cursor:'grab', textAlign:'left',
      border:'1px solid ' + (s.dragTool === t.id ? A : '#e3e7ee'), background: s.dragTool === t.id ? '#eef2ff' : '#fbfcfd', color:'#334155' } as CSSProperties,
    glyph: { width:'20px', height:'20px', borderRadius:'6px', background:'#eef1f6', display:'grid', placeItems:'center', fontSize:'10px', color:'#475569', flex:'0 0 20px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties
  }));

  /* ── page thumbs ── */
  const thumbs = [1,2,3].map(n => {
    const cnt = s.fields.filter(f => f.page === n).length;
    const on = s.page === n;
    return { n: String(n), key: n,
      onClick: () => set({ page: n, selected: [] }),
      style: { display:'flex', alignItems:'center', gap:'10px', padding:'8px', borderRadius:'11px', cursor:'pointer', width:'100%',
        border:'1px solid ' + (on ? A : '#e3e7ee'), background: on ? '#eef2ff' : '#fff' } as CSSProperties,
      sheet: { width:'32px', height:'42px', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'3px', display:'flex', flexDirection:'column', gap:'3px', padding:'5px', flex:'0 0 32px' } as CSSProperties,
      line1: { height:'2px', background:'#cbd5e1', borderRadius:'2px' } as CSSProperties,
      line2: { height:'2px', background:'#e3e7ee', borderRadius:'2px', width:'80%' } as CSSProperties,
      line3: { height:'2px', background:'#e3e7ee', borderRadius:'2px', width:'60%' } as CSSProperties,
      badgeLabel: cnt ? cnt + ' fields' : 'no fields',
      badge: { fontSize:'10px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: cnt ? '#047857' : '#94a3b8' } as CSSProperties };
  });

  /* ── canvas ── */
  const zoomLabel = Math.round(s.zoom * 100) + '%';
  const zoomIn = () => set({ zoom: Math.min(2, +(s.zoom + 0.1).toFixed(2)) });
  const zoomOut = () => set({ zoom: Math.max(0.5, +(s.zoom - 0.1).toFixed(2)) });
  const fitWidth = () => set({ zoom: 1 });
  const fitPage = () => set({ zoom: 0.7 });
  const toggleGrid = () => set({ grid: !s.grid });
  const selLabel = s.selected.length ? s.selected.length + ' selected · ⌘D duplicate · ⌫ delete' : 'Lasso the page to multi-select';
  const sheetWrapStyle: CSSProperties = { width: (816 * s.zoom) + 'px', height: (1056 * s.zoom) + 'px', flex:'0 0 auto' };
  const sheetStyle: CSSProperties = { position:'relative', width:'816px', height:'1056px', background:'#fff', borderRadius:'3px',
    boxShadow:'0 24px 60px -24px rgba(15,23,42,.35), 0 0 0 1px #dfe4ec', transform:'scale(' + s.zoom + ')', transformOrigin:'top left', touchAction:'none' };
  const gridOverlay: CSSProperties = { position:'absolute', inset:0, pointerEvents:'none', opacity: s.grid ? 1 : 0,
    backgroundImage:'linear-gradient(to right, rgba(99,102,241,.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,.09) 1px, transparent 1px)',
    backgroundSize:'8px 8px' };
  const marqueeStyle: CSSProperties = s.marquee ? { position:'absolute', left:s.marquee.x + 'px', top:s.marquee.y + 'px', width:s.marquee.w + 'px', height:s.marquee.h + 'px',
    border:'1px solid ' + A, background: A + '14', borderRadius:'3px', pointerEvents:'none' } : {};
  const guides = s.guides.map((g, i) => ({ key: i, style: (g.axis === 'v'
    ? { position:'absolute', left:g.at + 'px', top:0, bottom:0, width:'1px', background:'#f43f5e', pointerEvents:'none' }
    : { position:'absolute', top:g.at + 'px', left:0, right:0, height:'1px', background:'#f43f5e', pointerEvents:'none' }) as CSSProperties }));

  const pageFields = s.fields.filter(f => f.page === s.page).map(f => {
    const r = recip(f.to), t = meta(f.type);
    const on = s.selected.indexOf(f.id) > -1;
    return {
      id: f.id,
      aria: t.label + ' for ' + r.name + (f.required ? ', required' : ', optional') + ', at ' + f.x + ' by ' + f.y,
      selected: on,
      onDown: (e: React.PointerEvent) => I.onFieldDown(f.id, e),
      onResize: (e: React.PointerEvent) => I.onResizeDown(f.id, e),
      onKey: (e: React.KeyboardEvent) => { if (e.key === 'Enter') set({ selected: [f.id] }); },
      box: { position:'absolute', left:f.x + 'px', top:f.y + 'px', width:f.w + 'px', height:f.h + 'px',
        background: r.color + '1f', border:'1.5px solid ' + r.color, borderRadius:'6px', cursor:'grab',
        boxShadow: on ? '0 0 0 2px #fff, 0 0 0 4px ' + r.color + '66' : 'none',
        display:'flex', alignItems:'center', justifyContent:'center', padding:'2px 6px', outline:'none' } as CSSProperties,
      badge: { position:'absolute', top:'-9px', left:'-1px', height:'17px', padding:'0 6px', borderRadius:'5px', background:r.color,
        color:'#fff', fontSize:'9.5px', fontWeight:700, display:'flex', alignItems:'center', gap:'4px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap' } as CSSProperties,
      badgeText: initials(r.name) + ' · ' + t.label + (f.required ? ' *' : ''),
      label: f.label,
      inner: { fontSize: f.w < 110 ? '10px' : '11.5px', fontWeight:600, color:'#0f172a', opacity:.75, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 } as CSSProperties,
      handle: { position:'absolute', right:'-5px', bottom:'-5px', width:'11px', height:'11px', borderRadius:'3px', background:'#fff', border:'1.5px solid ' + r.color, cursor:'nwse-resize' } as CSSProperties
    };
  });

  /* ── inspector ── */
  const selection = sel();
  const one = selection.length === 1 ? selection[0] : null;
  const condOptions = s.fields.filter(f => one && f.id !== one.id && f.page === (one ? one.page : 1))
    .map(f => ({ id: f.id, label: f.label + ' (' + meta(f.type).label + ')' }));
  const mergeSuggestions = ['{{client.name}}','{{client.email}}','{{contract.amount}}','{{contract.signedAt}}'].map(tag => ({
    tag, onClick: () => { if (one) setField(one.id, { merge: tag }); },
    style: { padding:'4px 8px', borderRadius:'7px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'10.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#475569', cursor:'pointer' } as CSSProperties
  }));
  const cond = one && one.cond ? one.cond : { field:'', op:'checked', value:'' };
  const condTrigger = cond.field ? s.fields.find(f => f.id === cond.field) : null;
  const condSummary = condTrigger
    ? 'Show “' + (one ? one.label : '') + '” only when “' + condTrigger.label + '” ' +
      (cond.op === 'equals' ? 'equals “' + cond.value + '”' : COND_OP_LABEL[cond.op]) + '.'
    : 'Always visible to the assigned recipient.';
  const condSummaryStyle: CSSProperties = { fontSize:'11.5px', color: condTrigger ? '#3730a3' : '#64748b', background: condTrigger ? '#eef2ff' : '#f5f6f8', border:'1px solid ' + (condTrigger ? '#c7d2fe' : '#e3e7ee'), borderRadius:'8px', padding:'8px 9px', lineHeight:1.5 };
  const inspIcon: CSSProperties = { width:'30px', height:'30px', borderRadius:'9px', background: one ? recip(one.to).color : '#e3e7ee', color:'#fff', display:'grid', placeItems:'center', fontSize:'11px', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
  const regexBox: CSSProperties = { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'10.5px', color:'#475569', background:'#f5f6f8', border:'1px solid #e3e7ee', borderRadius:'8px', padding:'8px 9px', wordBreak:'break-all' };
  const rowBtn: CSSProperties = { display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'transparent', border:'none', cursor:'pointer', padding:'2px 0' };
  const reqSwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: one && one.required ? '#10b981' : '#cbd5e1', position:'relative', transition:'background .15s' };
  const reqKnob: CSSProperties = { position:'absolute', top:'2px', left: one && one.required ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' };
  const roSwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: one && one.readOnly ? A : '#cbd5e1', position:'relative' };
  const roKnob: CSSProperties = { position:'absolute', top:'2px', left: one && one.readOnly ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' };
  const recipientOptions = recips().map(r => ({ id: r.id, label: r.name + ' — ' + r.status }));

  /* ── step 2: routing / send setup ── */
  const routingRows = recips().map((r, i, arr) => ({
    id: r.id,
    name: r.name, email: r.email, role: r.role, order: s.routing === 'parallel' ? '=' : String(r.order), status: r.status,
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd' } as CSSProperties,
    orderStyle: { width:'26px', height:'26px', borderRadius:'8px', background:r.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'11.5px', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
    selectStyle: Object.assign({}, inputStyle, { width:'160px' }) as CSSProperties,
    onRole: (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      set({ recipients: arr.map(x => (x.id === r.id ? Object.assign({}, x, { role: v }) : x)) });
    },
    onUp: () => reorder(r.id, -1),
    onDown: () => reorder(r.id, 1)
  }));
  const cadences = ['24h','48h','7 days','none'].map(c => ({
    id: c, label: c === 'none' ? 'No reminders' : 'Every ' + c, onClick: () => set({ cadence: c }),
    style: btn(s.cadence === c ? '#eef2ff' : '#fff', s.cadence === c ? '#3730a3' : '#475569', s.cadence === c ? '#c7d2fe' : '#e3e7ee')
  }));
  const routeNote = s.routing === 'sequential'
    ? 'Each recipient is notified only after the previous one completes. Signer 1 → Signer 2 → Signer 3.'
    : 'All recipients are notified simultaneously and may sign in any order.';
  const routeNoteStyle: CSSProperties = { fontSize:'12px', color:'#3730a3', background:'#eef2ff', border:'1px solid #c7d2fe', borderRadius:'10px', padding:'10px 11px', lineHeight:1.55 };
  const seqStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'12.5px', fontWeight: s.routing === 'sequential' ? 600 : 500, background: s.routing === 'sequential' ? '#fff' : 'transparent', color: s.routing === 'sequential' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'sequential' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const parStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'12.5px', fontWeight: s.routing === 'parallel' ? 600 : 500, background: s.routing === 'parallel' ? '#fff' : 'transparent', color: s.routing === 'parallel' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'parallel' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const sendChecks = ([
    ['9 fields assigned', 'Every required field has a recipient', '#10b981'],
    ['Disclosure attached', 'ESIGN consent v4.2 shown before signing', '#10b981'],
    ['2 merge tags unresolved', '{{contract.amount}} on page 2 will render empty', '#f59e0b'],
    ['Certificate enabled', 'Sealed PDF and audit trail on completion', '#10b981']
  ] as [string, string, string][]).map(([label, metaText, c]) => ({
    label, meta: metaText,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background:c, marginTop:'5px', flex:'0 0 8px' } as CSSProperties
  }));

  return (
    <section data-screen-label="Builder" style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div style={{ flex:'0 0 auto', height:'52px', display:'flex', alignItems:'center', gap:'14px', padding:'0 16px', background:'#fff', borderBottom:'1px solid #e3e7ee' }}>
        <button type="button" onClick={() => flash('Rename — inline title editing')} style={{ display:'flex', alignItems:'center', gap:'8px', background:'none', border:'none', cursor:'pointer', minWidth:0 }}>
          <span style={{ width:'24px', height:'24px', borderRadius:'7px', background:'#eef2ff', color:'#3730a3', display:'grid', placeItems:'center', fontSize:'9px', fontWeight:700, flex:'0 0 24px' }}>DOC</span>
          <span style={{ fontSize:'13px', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>Master Services Agreement — Acme Corp ✎</span>
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', margin:'0 auto' }}>
          <button type="button" onClick={goStep1} style={wizardStepStyle1}><span style={wizardDot1}></span>Prepare</button>
          <span style={wizardLine}></span>
          <button type="button" onClick={goStep2} style={wizardStepStyle2}><span style={wizardDot2}></span>Set up and send</button>
        </div>
        <div style={{ display:'flex', gap:'8px', flex:'0 0 auto' }}>
          <button type="button" onClick={saveClose} style={ghostBtn}>Save and close</button>
          <button type="button" onClick={wizardNext} style={primaryBtn}>{wizardCta}</button>
        </div>
      </div>

      <div style={prepareRowStyle}>

        <div data-sf-scroll="1" style={{ width:'270px', flex:'0 0 270px', borderRight:'1px solid #e3e7ee', background:'#fff', overflow:'auto', padding:'14px', display:'flex', flexDirection:'column', gap:'18px' }}>
          <div>
            <div style={railHead}>Recipients</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px', marginTop:'9px' }}>
              {recipientCards.map(r => (
                <button key={r.id} type="button" onClick={r.onClick} style={r.style}>
                  <span style={r.chip}>{r.order}</span>
                  <span style={{ display:'flex', flexDirection:'column', lineHeight:1.25, textAlign:'left', minWidth:0 }}>
                    <span style={{ fontSize:'12.5px', fontWeight:600, color:'#0f172a' }}>{r.name}</span>
                    <span style={{ fontSize:'11px', color:'#64748b' }}>{r.role} · {r.fieldCount} fields</span>
                  </span>
                  <span style={r.stateStyle}>{r.state}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={railHead}>Field palette</div>
            <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'9px', marginTop:'8px' }}>
              {paletteTabs.map(t => (
                <button key={t.id} type="button" onClick={t.onClick} aria-pressed={t.selected} style={t.style}>{t.label}</button>
              ))}
            </div>
            <input type="search" value={s.paletteQuery} onChange={e => set({ paletteQuery: e.target.value })} placeholder="Search fields" aria-label="Search fields" style={{ marginTop:'7px', height:'30px', width:'100%', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 10px', fontSize:'12px', outline:'none', background:'#fbfcfd' }} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'7px', marginTop:'9px' }}>
              {tools.map(t => (
                <button key={t.id} type="button" onPointerDown={t.onDown} aria-label={t.aria} style={t.style}>
                  <span style={t.glyph}>{t.icon}</span>
                  <span style={{ fontSize:'11.5px', fontWeight:500 }}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
              <div style={railHead}>Pages</div>
              <button type="button" onClick={() => flash('Blank page appended · page ' + (3 + 1))} style={linkBtn(A)}>+ Add page</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginTop:'9px' }}>
              {thumbs.map(p => (
                <button key={p.key} type="button" onClick={p.onClick} style={p.style}>
                  <span style={p.sheet}>
                    <span style={p.line1}></span><span style={p.line2}></span><span style={p.line3}></span>
                  </span>
                  <span style={{ display:'flex', flexDirection:'column', gap:'4px', textAlign:'left' }}>
                    <span style={{ fontSize:'12px', fontWeight:600 }}>Page {p.n}</span>
                    <span style={p.badge}>{p.badgeLabel}</span>
                  </span>
                  <span style={{ marginLeft:'auto', fontSize:'11px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>↕</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', background:'#eceff4' }}>
          <div style={{ height:'46px', flex:'0 0 46px', borderBottom:'1px solid #e3e7ee', background:'#fff', display:'flex', alignItems:'center', gap:'10px', padding:'0 14px' }}>
            <button type="button" aria-label="Undo" onClick={() => flash('Undo — last field change reverted')} style={iconBtn}>↺</button>
            <button type="button" aria-label="Redo" onClick={() => flash('Redo')} style={iconBtn}>↻</button>
            <span style={{ width:'1px', height:'20px', background:'#e3e7ee' }}></span>
            <div style={{ display:'flex', alignItems:'center', gap:'2px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'2px' }}>
              <button type="button" aria-label="Zoom out" onClick={zoomOut} style={iconBtn}>−</button>
              <span style={{ minWidth:'52px', textAlign:'center', fontSize:'12px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#334155' }}>{zoomLabel}</span>
              <button type="button" aria-label="Zoom in" onClick={zoomIn} style={iconBtn}>+</button>
            </div>
            <button type="button" onClick={fitWidth} style={chipBtn}>Fit width</button>
            <button type="button" onClick={fitPage} style={chipBtn}>Fit page</button>
            <span style={{ width:'1px', height:'20px', background:'#e3e7ee' }}></span>
            <button type="button" onClick={toggleGrid} style={gridBtnStyle}>Snap grid</button>
            <span style={{ width:'1px', height:'20px', background:'#e3e7ee' }}></span>
            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
              <button type="button" onClick={I.alignLeft} style={alignStyle}>Align left</button>
              <button type="button" onClick={I.alignCenterX} style={alignStyle}>Center</button>
              <button type="button" onClick={I.distribute} style={alignStyle}>Distribute</button>
              <button type="button" onClick={I.duplicateSel} style={alignStyle}>Duplicate</button>
              <button type="button" onClick={I.deleteSel} style={dangerStyle}>Delete</button>
            </div>
            <button type="button" onClick={() => flash('Preview opened · signer view of page ' + s.page)} style={chipBtn}>Open preview</button>
            <span style={{ marginLeft:'auto', fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{selLabel}</span>
          </div>

          <div data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', padding:'26px', display:'flex', justifyContent:'center' }}>
            <div style={sheetWrapStyle}>
              <div ref={I.sheetRef} onPointerDown={I.onSheetDown} style={sheetStyle}>
                <div style={{ position:'absolute', inset:0, pointerEvents:'none', opacity:.55, padding:'64px 72px', display:'flex', flexDirection:'column', gap:'13px' }}>
                  <div style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'10px', letterSpacing:'.14em', color:'#94a3b8' }}>EXHIBIT A — PAGE {String(s.page)} OF 3</div>
                  <div style={{ fontSize:'21px', fontWeight:700, letterSpacing:'-.4px', color:'#0f172a' }}>Master Services Agreement</div>
                  <div style={{ fontSize:'11.5px', lineHeight:1.75, color:'#475569', maxWidth:'600px' }}>This Master Services Agreement (the “Agreement”) is entered into as of the Effective Date by and between Northwind Analytics, Inc., a Delaware corporation, and the Client identified in the signature block below. The parties agree that electronic signatures affixed hereto carry the same force and effect as manual signatures under the ESIGN Act and UETA.</div>
                  <div style={{ fontSize:'11.5px', lineHeight:1.75, color:'#475569', maxWidth:'600px' }}>1. Scope of Services. Provider shall perform the services described in each mutually executed Statement of Work. 2. Fees. Client shall pay the amounts set out in the applicable Order Form within thirty (30) days of invoice. 3. Confidentiality. Each party shall protect the other’s Confidential Information using no less than reasonable care.</div>
                  <div style={{ fontSize:'11.5px', lineHeight:1.75, color:'#475569', maxWidth:'600px' }}>4. Term and Termination. This Agreement commences on the Effective Date and continues for twelve (12) months unless terminated earlier for material breach. 5. Limitation of Liability. Neither party&apos;s aggregate liability shall exceed the fees paid in the preceding twelve months. 6. Governing Law. Delaware law governs, excluding its conflict-of-law rules.</div>
                  <div style={{ marginTop:'auto', display:'flex', justifyContent:'space-between', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'9.5px', color:'#a5b0c0' }}>
                    <span>SIGNFORGE ENVELOPE ENV-2291-KD</span><span>SHA-256 VERIFIED</span>
                  </div>
                </div>

                <div style={gridOverlay}></div>

                {pageFields.map(f => (
                  <div key={f.id} role="button" tabIndex={0} aria-label={f.aria} onPointerDown={f.onDown} onKeyDown={f.onKey} style={f.box}>
                    <span style={f.badge}>{f.badgeText}</span>
                    <span style={f.inner}>{f.label}</span>
                    {f.selected ? (
                      <span onPointerDown={f.onResize} style={f.handle}></span>
                    ) : null}
                  </div>
                ))}

                {s.marquee ? <div style={marqueeStyle}></div> : null}
                {guides.map(g => <div key={g.key} style={g.style}></div>)}
              </div>
            </div>
          </div>
        </div>

        <div data-sf-scroll="1" style={{ width:'310px', flex:'0 0 310px', borderLeft:'1px solid #e3e7ee', background:'#fff', overflow:'auto' }}>
          {one ? (
            <div style={{ padding:'14px', display:'flex', flexDirection:'column', gap:'16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <span style={inspIcon}>{meta(one.type).icon}</span>
                <div style={{ display:'flex', flexDirection:'column', lineHeight:1.25 }}>
                  <span style={{ fontSize:'13.5px', fontWeight:600 }}>{meta(one.type).label}</span>
                  <span style={{ fontSize:'11px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{one.id + ' · page ' + one.page}</span>
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                <label style={lbl}>Label
                  <input type="text" value={one.label} onChange={e => setField(one.id, { label: e.target.value })} style={input} />
                </label>
                <label style={lbl}>Placeholder
                  <input type="text" value={one.placeholder} onChange={e => setField(one.id, { placeholder: e.target.value })} style={input} />
                </label>
                <label style={lbl}>Assigned recipient
                  <select value={one.to} onChange={e => setField(one.id, { to: e.target.value })} style={input}>
                    {recipientOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                  <label style={lbl}>X
                    <input type="number" value={one.x} onChange={e => setField(one.id, { x: parseInt(e.target.value || '0', 10) })} style={input} />
                  </label>
                  <label style={lbl}>Y
                    <input type="number" value={one.y} onChange={e => setField(one.id, { y: parseInt(e.target.value || '0', 10) })} style={input} />
                  </label>
                  <label style={lbl}>Width
                    <input type="number" value={one.w} onChange={e => setField(one.id, { w: Math.max(32, parseInt(e.target.value || '32', 10)) })} style={input} />
                  </label>
                  <label style={lbl}>Height
                    <input type="number" value={one.h} onChange={e => setField(one.id, { h: Math.max(24, parseInt(e.target.value || '24', 10)) })} style={input} />
                  </label>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'7px', border:'1px solid #eef1f6', borderRadius:'11px', padding:'10px', background:'#fbfcfd' }}>
                  <button type="button" role="switch" aria-checked={!!one.required} onClick={() => setField(one.id, { required: !one.required })} style={rowBtn}>
                    <span style={{ fontSize:'12.5px' }}>Required</span><span style={reqSwitch}><span style={reqKnob}></span></span>
                  </button>
                  <button type="button" role="switch" aria-checked={!!one.readOnly} onClick={() => setField(one.id, { readOnly: !one.readOnly })} style={rowBtn}>
                    <span style={{ fontSize:'12.5px' }}>Read-only</span><span style={roSwitch}><span style={roKnob}></span></span>
                  </button>
                </div>
                <label style={lbl}>Validation
                  <select value={one.validation} onChange={e => setField(one.id, { validation: e.target.value })} style={input}>
                    <option value="none">None</option>
                    <option value="email">Email</option>
                    <option value="date">Date (MM/DD/YYYY)</option>
                    <option value="numeric">Numeric</option>
                    <option value="custom">Custom regex</option>
                  </select>
                </label>
                <div style={regexBox}>{REGEX_MAP[one.validation]}</div>
              </div>

              <div style={{ borderTop:'1px solid #eef1f6', paddingTop:'14px', display:'flex', flexDirection:'column', gap:'10px' }}>
                <div style={railHead}>Conditional logic</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px', border:'1px solid #eef1f6', borderRadius:'11px', padding:'10px', background:'#fbfcfd' }}>
                  <div style={{ fontSize:'11.5px', color:'#64748b' }}>Show this field only if</div>
                  <select value={cond.field} onChange={e => setField(one.id, { cond: e.target.value ? { field: e.target.value, op: cond.op, value: cond.value } : null })} style={input} aria-label="Trigger field">
                    <option value="">— always show —</option>
                    {condOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                    <select value={cond.op} onChange={e => { if (one.cond) setField(one.id, { cond: Object.assign({}, one.cond, { op: e.target.value }) }); }} style={input} aria-label="Operator">
                      <option value="checked">is checked</option>
                      <option value="equals">equals</option>
                      <option value="notEmpty">is not empty</option>
                    </select>
                    <input type="text" value={cond.value} onChange={e => { if (one.cond) setField(one.id, { cond: Object.assign({}, one.cond, { value: e.target.value }) }); }} placeholder="value" aria-label="Comparison value" style={input} />
                  </div>
                  <div style={condSummaryStyle}>{condSummary}</div>
                </div>
              </div>

              <div style={{ borderTop:'1px solid #eef1f6', paddingTop:'14px', display:'flex', flexDirection:'column', gap:'9px' }}>
                <div style={railHead}>Data binding</div>
                <input type="text" value={one.merge} onChange={e => setField(one.id, { merge: e.target.value })} placeholder="{{client.name}}" aria-label="Merge tag" style={mono} />
                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                  {mergeSuggestions.map(m => (
                    <button key={m.tag} type="button" onClick={m.onClick} style={m.style}>{m.tag}</button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {!one ? (
            <div style={{ padding:'30px 20px', display:'flex', flexDirection:'column', gap:'9px', textAlign:'center', color:'#94a3b8' }}>
              <span style={{ fontSize:'13px', fontWeight:600, color:'#475569' }}>No field selected</span>
              <span style={{ fontSize:'12px', lineHeight:1.5 }}>Select a field on the page — or lasso several — to configure labels, validation, conditional logic and merge tags.</span>
            </div>
          ) : null}
        </div>
      </div>

      {s.wizardStep === 2 ? (
        <div data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', padding:'22px', display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start', background:'#eceff4' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
                <div style={railHead}>Recipients &amp; signing order</div>
                <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px' }}>
                  <button type="button" onClick={() => set({ routing: 'sequential' })} style={seqStyle}>Sequential</button>
                  <button type="button" onClick={() => set({ routing: 'parallel' })} style={parStyle}>Parallel</button>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
                {routingRows.map(r => (
                  <div key={r.id} style={r.rowStyle}>
                    <span style={r.orderStyle}>{r.order}</span>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0, flex:1 }}>
                      <span style={{ fontSize:'13px', fontWeight:600 }}>{r.name}</span>
                      <span style={{ fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.email}</span>
                    </div>
                    <select value={r.role} onChange={r.onRole} aria-label="Role" style={r.selectStyle}>
                      <option value="sign">Needs to sign</option>
                      <option value="inperson">In-person signer</option>
                      <option value="copy">Receives a copy</option>
                      <option value="approve">Approver</option>
                    </select>
                    <div style={{ display:'flex', gap:'4px' }}>
                      <button type="button" aria-label="Move up" onClick={r.onUp} style={iconBtn}>↑</button>
                      <button type="button" aria-label="Move down" onClick={r.onDown} style={iconBtn}>↓</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={routeNoteStyle}>{routeNote}</div>
            </div>

            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={railHead}>Invite email</div>
              <label style={lbl}>Subject
                <input type="text" defaultValue="Master Services Agreement: signature request from Priya Raman" style={input} />
              </label>
              <label style={lbl}>Message
                <textarea rows={4} onChange={e => set({ message: e.target.value })} value={s.message} style={textareaStyle}></textarea>
              </label>
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={railHead}>Reminders &amp; expiration</div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                {cadences.map(c => (
                  <button key={c.id} type="button" onClick={c.onClick} style={c.style}>{c.label}</button>
                ))}
              </div>
              <label style={lbl}>Expires after
                <select value={s.expiry} onChange={e => set({ expiry: e.target.value })} style={input}>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                </select>
              </label>
            </div>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
              <div style={railHead}>Before you send</div>
              {sendChecks.map(c => (
                <div key={c.label} style={{ display:'flex', alignItems:'flex-start', gap:'9px', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
                  <span style={c.dot}></span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={{ fontSize:'12.5px', fontWeight:600 }}>{c.label}</span>
                    <span style={{ fontSize:'11px', color:'#64748b', lineHeight:1.5 }}>{c.meta}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
