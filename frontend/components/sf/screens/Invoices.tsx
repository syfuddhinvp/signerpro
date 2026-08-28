'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { btn, pill, railHead, INV_STATUS_TONE, INV_STATUS_LABEL } from '@/lib/sf/ui';
import { INVOICES, INVOICE_FILTERS } from '@/lib/sf/data';

export default function Invoices() {
  const { s, set, flash, accent, money, isPlat, invoicesFiltered } = useSF();
  const A = accent();
  const plat = isPlat();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const scoped = INVOICES.filter(i => plat || i.slug === 'acme');

  const invoiceFilters = INVOICE_FILTERS.map(([id, label]) => {
    const on = s.invoiceFilter === id;
    return {
      id, label, selected: (on ? 'true' : 'false') as 'true' | 'false',
      onClick: () => set({ invoiceFilter: id }),
      style: { height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties
    };
  });

  const invoiceList = invoicesFiltered();

  const invoices = invoiceList.map((i: any, idx: number) => ({
    number: i.number, who: plat ? i.tenant : i.period, period: plat ? i.period : i.method, pi: i.pi,
    statusLabel: INV_STATUS_LABEL[i.status], total: money(i.total), due: i.due,
    pill: pill(INV_STATUS_TONE[i.status]),
    onOpen: () => set({ openInvoice: i.number }),
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'12px 15px', borderTop: idx ? '1px solid #f2f4f8' : 'none', width:'100%',
      background: s.openInvoice === i.number ? '#f8faff' : 'transparent', border:'none', borderLeft:'3px solid ' + (s.openInvoice === i.number ? A : 'transparent'), cursor:'pointer', flexWrap:'wrap' } as CSSProperties
  }));

  const inv: any = INVOICES.find(i => i.number === s.openInvoice) || scoped[0] || INVOICES[0];
  const invLines = inv.lines.map(([d, amt]: [string, string]) => ({ d, amt }));
  const invTotals = [
    { k:'Subtotal', v: money(inv.sub), bold:false },
    { k:'Tax', v: money(inv.tax), bold:false },
    { k:'Total', v: money(inv.total), bold:true }
  ].map(t => ({ k:t.k, v:t.v, style: { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontWeight: t.bold ? 700 : 500, fontSize: t.bold ? '14px' : '12.5px', color:'#0f172a' } as CSSProperties }));
  const invMetaRows = [
    { k:'Payment intent', v:inv.pi }, { k:'Payment method', v:inv.method },
    { k:'Customer', v:inv.tenant }, { k:'Hosted invoice', v:'invoice.stripe.com/i/' + inv.number.toLowerCase() },
    { k:'Due', v:inv.due }
  ];

  const invoiceScopeLabel = plat ? 'All tenants · ' + invoiceList.length + ' invoices' : 'Acme Corporation · ' + invoiceList.length + ' invoices';
  const invNumber = inv.number;
  const invStatus = INV_STATUS_LABEL[inv.status];
  const invPill = pill(INV_STATUS_TONE[inv.status]);
  const invMeta = inv.tenant + ' · ' + inv.period + ' · issued ' + inv.period;
  const invPrimaryLabel = inv.status === 'paid' ? 'View receipt' : (inv.status === 'void' ? 'Reopen invoice' : 'Pay ' + money(inv.total));
  const invPrimaryAction = () => {
    if (inv.status === 'paid') flash('Receipt opened · ' + inv.pi);
    else if (inv.status === 'void') flash(inv.number + ' reopened as draft');
    else set({ modal: 'pay' });
  };
  const invDownload = () => flash(inv.number + '.pdf downloaded');
  const invReceipt = () => flash('Receipt emailed to ' + s.billingEmail);

  return (
    <section data-screen-label="Invoices" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1.6fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
        <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
          <div style={railHead}>{invoiceScopeLabel}</div>
          <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px' }}>
            {invoiceFilters.map(f => (
              <button key={f.id} type="button" onClick={f.onClick} aria-pressed={f.selected} style={f.style}>{f.label}</button>
            ))}
          </div>
        </div>
        {invoices.map(i => (
          <button key={i.number} type="button" onClick={i.onOpen} style={i.rowStyle}>
            <span style={{ display:'flex', flexDirection:'column', gap:'3px', textAlign:'left', flex:'1 1 190px', minWidth:'170px' }}>
              <span style={{ fontSize:'13px', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.number} · {i.who}</span>
              <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.period} · {i.pi}</span>
            </span>
            <span style={i.pill}>{i.statusLabel}</span>
            <span style={{ fontSize:'13px', fontWeight:600, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto', width:'96px', textAlign:'right' }}>{i.total}</span>
            <span style={{ fontSize:'11px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto', width:'86px', textAlign:'right' }}>{i.due}</span>
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
            <span style={{ fontSize:'15px', fontWeight:700, letterSpacing:'-.2px' }}>{invNumber}</span>
            <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{invMeta}</span>
          </div>
          <span style={invPill}>{invStatus}</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
          {invLines.map((l: any, li: number) => (
            <div key={li} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'12.5px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={{ color:'#334155', minWidth:0 }}>{l.d}</span>
              <span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' }}>{l.amt}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'6px', borderTop:'1px solid #e3e7ee', paddingTop:'11px' }}>
          {invTotals.map(t => (
            <div key={t.k} style={{ display:'flex', justifyContent:'space-between', fontSize:'12.5px' }}>
              <span style={{ color:'#64748b' }}>{t.k}</span><span style={t.style}>{t.v}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'7px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
          {invMetaRows.map(m => (
            <div key={m.k} style={{ display:'flex', justifyContent:'space-between', gap:'10px', fontSize:'11.5px' }}>
              <span style={{ color:'#64748b' }}>{m.k}</span><span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#334155', textAlign:'right', wordBreak:'break-all' }}>{m.v}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
          <button type="button" onClick={invPrimaryAction} style={primaryBtn}>{invPrimaryLabel}</button>
          <button type="button" onClick={invDownload} style={ghostBtn}>Download PDF</button>
          <button type="button" onClick={invReceipt} style={ghostBtn}>Email receipt</button>
        </div>
      </div>
    </section>
  );
}
