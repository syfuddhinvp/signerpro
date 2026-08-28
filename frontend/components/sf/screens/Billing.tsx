'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { btn, pill, railHead, lbl, inputStyle } from '@/lib/sf/ui';
import { PM_DEFS, UPCOMING_LINES, CHARGES } from '@/lib/sf/data';

export default function Billing() {
  const { s, set, flash, accent } = useSF();
  const A = accent();

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);
  const input = inputStyle;
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11.5px' });

  const subStatus = 'Active';
  const subPill = pill({ bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' });

  const subTiles = [
    { label:'SEATS', value:'1,240', meta:'1,102 activated' },
    { label:'NEXT INVOICE', value:'$41,196', meta:'1 Sep 2026' },
    { label:'CYCLE', value: s.cycle === 'annual' ? 'Annual' : 'Monthly', meta: s.cycle === 'annual' ? 'renews 1 Sep 2027' : 'renews 1 Sep 2026' },
  ];

  const paymentMethods = PM_DEFS.map(p => {
    const def = s.defaultPm === p.id;
    return {
      id: p.id, brand: p.brand, label: p.label, meta: p.meta, isDefault: def, notDefault: !def,
      rowStyle: { display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid ' + (def ? '#c7d2fe' : '#eef1f6'), borderRadius:'12px', background: def ? '#f8faff' : '#fbfcfd' } as CSSProperties,
      brandStyle: { width:'46px', height:'30px', borderRadius:'7px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'9.5px', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 46px' } as CSSProperties,
      defaultPill: pill({ bg:'#eef2ff', fg:'#3730a3', bd:'#c7d2fe' }),
      onDefault: () => { set({ defaultPm: p.id }); flash(p.label + ' set as default payment method'); },
    };
  });

  const upcomingLines = UPCOMING_LINES;

  const charges = CHARGES.map(([amount, meta, status, tone]) => ({
    amount, meta, status,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background: tone === 'good' ? '#10b981' : '#f59e0b', flex:'0 0 8px' } as CSSProperties,
    pill: pill(tone === 'good' ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' }),
  }));

  const autopayStr = s.autopay ? 'true' : 'false';
  const autopayRow: CSSProperties = { display:'inline-flex', alignItems:'center', gap:'9px', height:'32px', padding:'0 12px', borderRadius:'9px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer' };
  const autopaySwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: s.autopay ? '#10b981' : '#cbd5e1', position:'relative', flex:'0 0 34px' };
  const autopayKnob: CSSProperties = { position:'absolute', top:'2px', left: s.autopay ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' };
  const toggleAutopay = () => { set({ autopay: !s.autopay }); flash('Autopay ' + (s.autopay ? 'disabled' : 'enabled')); };

  const openCardModal = () => set({ modal: 'card' });
  const openCheckout = () => set({ modal: 'seats' });
  const openPlanChange = () => set({ modal: 'plan' });
  const goInvoices = () => set({ screen: 'invoices' });

  return (
    <section data-screen-label="Billing" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <span style={railHead}>Current subscription</span>
              <div style={{ display:'flex', alignItems:'baseline', gap:'9px' }}>
                <span style={{ fontSize:'22px', fontWeight:700, letterSpacing:'-.5px' }}>Enterprise</span>
                <span style={subPill}>{subStatus}</span>
              </div>
              <span style={{ fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>sub_1QhT7xKz · 1,240 seats × $44 · billed monthly</span>
            </div>
            <div style={{ display:'flex', gap:'8px', flex:'0 0 auto' }}>
              <button type="button" onClick={openPlanChange} style={ghostBtn}>Change plan</button>
              <button type="button" onClick={openCheckout} style={primaryBtn}>Add seats</button>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'11px' }}>
            {subTiles.map(t => (
              <div key={t.label} style={{ border:'1px solid #eef1f6', borderRadius:'12px', padding:'12px', background:'#fbfcfd', display:'flex', flexDirection:'column', gap:'5px' }}>
                <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", letterSpacing:'.05em' }}>{t.label}</span>
                <span style={{ fontSize:'17px', fontWeight:700, letterSpacing:'-.4px' }}>{t.value}</span>
                <span style={{ fontSize:'11px', color:'#64748b' }}>{t.meta}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'13px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>Payment methods</div>
            <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>powered by Stripe · PCI DSS L1</span>
          </div>
          {paymentMethods.map(p => (
            <div key={p.id} style={p.rowStyle}>
              <span style={p.brandStyle}>{p.brand}</span>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                <span style={{ fontSize:'12.5px', fontWeight:600 }}>{p.label}</span>
                <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{p.meta}</span>
              </div>
              {p.isDefault ? (<span style={p.defaultPill}>Default</span>) : null}
              {p.notDefault ? (
                <button type="button" onClick={p.onDefault} style={ghostBtn}>Make default</button>
              ) : null}
            </div>
          ))}
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <button type="button" onClick={openCardModal} style={primaryBtn}>Add payment method</button>
            <button type="button" role="switch" aria-checked={autopayStr === 'true'} onClick={toggleAutopay} style={autopayRow}>
              <span style={{ fontSize:'12.5px', color:'#334155' }}>Autopay</span>
              <span style={autopaySwitch}><span style={autopayKnob}></span></span>
            </button>
          </div>
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={railHead}>Upcoming invoice · preview</div>
          {upcomingLines.map(l => (
            <div key={l.d} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'12.5px', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={{ color:'#334155' }}>{l.d}</span>
              <span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#0f172a', flex:'0 0 auto' }}>{l.amt}</span>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid #e3e7ee', paddingTop:'11px', fontSize:'14px', fontWeight:700 }}>
            <span>Total due 1 Sep 2026</span><span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>$41,196.00</span>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Billing details</div>
          <label style={lbl}>Billing email
            <input type="text" value={s.billingEmail} onChange={(e) => set({ billingEmail: e.target.value })} style={input} />
          </label>
          <label style={lbl}>Tax ID / VAT
            <input type="text" value={s.taxId} onChange={(e) => set({ taxId: e.target.value })} style={mono} />
          </label>
          <label style={lbl}>Billing cycle
            <select
              value={s.cycle}
              onChange={(e) => { const v = e.target.value; set({ cycle: v }); flash('Billing cycle → ' + (v === 'annual' ? 'annual (12% saved)' : 'monthly') + ' · prorated at next invoice'); }}
              style={input}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual (save 12%)</option>
            </select>
          </label>
          <div style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.55 }}>Invoices are issued from SignForge Inc., 400 Market St, San Francisco. Reverse-charge applies for EU VAT-registered entities.</div>
        </div>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Recent charges</div>
          {charges.map((c, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={c.dot}></span>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                <span style={{ fontSize:'12.5px', fontWeight:600 }}>{c.amount}</span>
                <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.meta}</span>
              </div>
              <span style={c.pill}>{c.status}</span>
            </div>
          ))}
          <button type="button" onClick={goInvoices} style={ghostBtn}>All invoices &amp; receipts</button>
        </div>
      </div>
    </section>
  );
}
