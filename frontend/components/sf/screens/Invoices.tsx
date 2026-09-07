'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { btn, pill, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import { INVOICE_FILTERS } from '@/lib/sf/data';
import { apiCall, proxyPath } from '@/lib/api/browser';
import { invoices as invoicesApi, platformInvoices as platformInvoicesApi } from '@/lib/api/resources';
import { EMPTY, declineNotice, toInvoiceRow, type InvoiceRow } from '@/lib/sf/adapters';

/**
 * Server data, fetched in `app/(app)/billing/invoices/page.tsx` (tenant scope)
 * and `app/(app)/platform/invoices/page.tsx` (`GET /api/saas/invoices`).
 * The status chips drive the API filter through the URL, so the list the
 * server renders is already the filtered one.
 */
export type InvoicesProps = {
  rows: InvoiceRow[];
  /** One of the design's four chips: `all | open | paid | past_due`. */
  filter: string;
  platform: boolean;
  /** `Acme Corporation` / `All tenants` — the rail's scope label. */
  scopeName: string;
};

export default function Invoices({ rows, filter, platform: plat, scopeName }: InvoicesProps) {
  const { s, set, flash, accent } = useSF();
  const router = useRouter();
  const pathname = usePathname();
  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  /* The rail selection is UI state; `openInvoice` holds the invoice id. */
  const selected = rows.find(i => i.id === s.openInvoice) || rows[0];

  /* `GET /api/invoices/{id}` is the authoritative detail; until it lands the
     list row (which already carries line items) is shown, so nothing flashes. */
  const [detail, setDetail] = useState<InvoiceRow | null>(null);
  const selectedId = selected ? selected.id : null;
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    void invoicesApi.get(apiCall, selectedId).then(res => {
      if (!live) return;
      setDetail(res.ok ? toInvoiceRow(res.data) : null);
    });
    return () => { live = false; };
  }, [selectedId]);

  const invoiceFilters = INVOICE_FILTERS.map(([id, label]) => {
    const on = filter === id;
    return {
      id, label, selected: (on ? 'true' : 'false') as 'true' | 'false',
      onClick: () => {
        /* The store keeps the prototype's value in sync; the URL is what the
           server page reads to filter through `GET /api/invoices?status=`. */
        set({ invoiceFilter: id });
        router.replace(id === 'all' ? pathname : pathname + '?status=' + id);
      },
      style: { height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.75rem', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties
    };
  });

  const invoiceList = rows;

  const invoices = invoiceList.map((i, idx) => ({
    id: i.id,
    number: i.number, who: plat ? i.tenant : i.period, period: plat ? i.period : i.method, pi: i.pi,
    statusLabel: i.statusLabel, total: i.total, due: i.due,
    pill: pill(i.tone),
    onOpen: () => set({ openInvoice: i.id }),
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'12px 15px', borderTop: idx ? '1px solid #f2f4f8' : 'none', width:'100%',
      background: selectedId === i.id ? '#f8faff' : 'transparent', border:'none', borderLeft:'3px solid ' + (selectedId === i.id ? A : 'transparent'), cursor:'pointer', flexWrap:'wrap' } as CSSProperties
  }));

  /* The prototype always had rows; a fresh tenant (or a filter with no hits)
     has none, and the detail rail assumed `scoped[0]` existed. */
  if (!selected) {
    return (
      <section data-screen-label="Invoices" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1.6fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
          <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={railHead}>{scopeName + ' · 0 invoices'}</div>
            <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px' }}>
              {invoiceFilters.map(f => (
                <button key={f.id} type="button" onClick={f.onClick} aria-pressed={f.selected} style={f.style}>{f.label}</button>
              ))}
            </div>
          </div>
          <div style={{ padding:'22px 15px', fontSize:'.78125rem', color:'#64748b' }}>No invoices in this view yet.</div>
        </div>
        <div />
      </section>
    );
  }

  const inv = detail && detail.id === selected.id ? detail : selected;
  const invLines = inv.lines;
  const invTotals = [
    { k:'Subtotal', v: inv.subtotal, bold:false },
    { k:'Tax', v: inv.tax, bold:false },
    { k:'Total', v: inv.total, bold:true }
  ].map(t => ({ k:t.k, v:t.v, style: { fontFamily:'var(--font-sans)', fontWeight: t.bold ? 700 : 500, fontSize: t.bold ? '.875rem' : '.78125rem', color:'#0f172a' } as CSSProperties }));
  const invMetaRows = [
    { k:'Payment intent', v:inv.pi }, { k:'Payment method', v:inv.method },
    { k:'Customer', v:inv.tenant }, { k:'Hosted invoice', v:inv.hostedUrl },
    { k:'Due', v:inv.due }
  ];

  const invoiceScopeLabel = scopeName + ' · ' + invoiceList.length + ' invoices';
  const invNumber = inv.number;
  const invStatus = inv.statusLabel;
  const invPill = pill(inv.tone);
  const invMeta = inv.tenant + ' · ' + inv.period + ' · issued ' + inv.issued;
  const invPrimaryLabel = inv.isPaid ? 'View receipt' : (inv.isVoid ? 'Reopen invoice' : 'Pay ' + inv.total);

  const openInBrowser = (path: string) => {
    const target = proxyPath(path);
    if (target) window.open(target, '_blank', 'noopener');
  };

  /* A decline is a 402 whose body carries `decline_code`; `ApiError` keeps only
     the message, so the invoice is re-read to report its dunning state. */
  const reportDecline = (id: string, number: string) => {
    void invoicesApi.get(apiCall, id).then(res => {
      flash(declineNotice(number, null, res.ok ? res.data.status : null));
      router.refresh();
    });
  };

  const invPrimaryAction = () => {
    if (inv.isPaid) { openInBrowser(invoicesApi.receiptPath(inv.id)); flash('Receipt opened · ' + inv.number); return; }
    if (inv.isVoid) {
      /* Awaiting an endpoint: nothing on the API reopens a voided invoice
         (`POST /api/saas/invoices/{id}/void` is one-way). */
      flash(inv.number + ' cannot be reopened · no reopen endpoint yet');
      return;
    }
    if (!plat) { set({ modal: 'pay' }); return; }
    /* Platform scope collects through the provider rather than the tenant's
       checkout modal: POST /api/saas/invoices/{id}/retry-payment. */
    flash('Retrying ' + inv.number + ' · ' + inv.total);
    void platformInvoicesApi.retryPayment(apiCall, inv.id).then(res => {
      if (!res.ok) {
        if (res.status === 402) { reportDecline(inv.id, inv.number); return; }
        flash('Could not collect ' + inv.number + ' · ' + res.error.message);
        return;
      }
      flash(inv.number + ' paid · ' + inv.total + ' collected');
      router.refresh();
    });
  };
  const invDownload = () => { openInBrowser(invoicesApi.pdfPath(inv.id)); flash(inv.number + '.pdf downloaded'); };
  const invReceipt = () => {
    if (!inv.isPaid) { flash('A receipt exists only once ' + inv.number + ' is paid'); return; }
    /* Awaiting an endpoint: the API renders a receipt PDF but has no
       "email it" route, so the download is what actually happens. */
    openInBrowser(invoicesApi.receiptPath(inv.id));
    flash('Receipt downloaded · ' + (inv.method === EMPTY ? inv.number : inv.method));
  };

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
          <button key={i.id} type="button" onClick={i.onOpen} style={i.rowStyle}>
            <span style={{ display:'flex', flexDirection:'column', gap:'3px', textAlign:'left', flex:'1 1 190px', minWidth:'170px' }}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.number} · {i.who}</span>
              <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.period} · {i.pi}</span>
            </span>
            <span style={i.pill}>{i.statusLabel}</span>
            <span style={{ fontSize:'.8125rem', fontWeight:600, fontFamily:'var(--font-sans)', flex:'0 0 auto', width:'96px', textAlign:'right' }}>{i.total}</span>
            <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)', flex:'0 0 auto', width:'86px', textAlign:'right' }}>{i.due}</span>
          </button>
        ))}
      </div>

      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
            <span style={{ fontSize:'.9375rem', fontWeight:700, letterSpacing:'-.2px' }}>{invNumber}</span>
            <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{invMeta}</span>
          </div>
          <span style={invPill}>{invStatus}</span>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
          {invLines.map((l, li: number) => (
            <div key={li} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'.78125rem', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={{ color:'#334155', minWidth:0 }}>{l.d}</span>
              <span style={{ fontFamily:'var(--font-sans)', flex:'0 0 auto' }}>{l.amt}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'6px', borderTop:'1px solid #e3e7ee', paddingTop:'11px' }}>
          {invTotals.map(t => (
            <div key={t.k} style={{ display:'flex', justifyContent:'space-between', fontSize:'.78125rem' }}>
              <span style={{ color:'#64748b' }}>{t.k}</span><span style={t.style}>{t.v}</span>
            </div>
          ))}
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'7px', borderTop:'1px solid #eef1f6', paddingTop:'12px' }}>
          {invMetaRows.map(m => (
            <div key={m.k} style={{ display:'flex', justifyContent:'space-between', gap:'10px', fontSize:'.71875rem' }}>
              <span style={{ color:'#64748b' }}>{m.k}</span><span style={{ fontFamily:'var(--font-sans)', color:'#334155', textAlign:'right', wordBreak:'break-all' }}>{m.v}</span>
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
