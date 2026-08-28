'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { btn, pill, railHead, lbl, inputStyle } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { billing as billingApi } from '@/lib/api/resources';
import {
  formatCents,
  subscriptionStatusTone,
  toChargeRows,
  toPaymentMethodRows,
  toSubscriptionSummary,
  toUpcomingLines,
  upcomingTotalLabel,
} from '@/lib/sf/adapters';
import type {
  BillingSettingsResponse,
  ChargeResponse,
  PaymentMethodResponse,
  SubscriptionResponse,
  UpcomingInvoiceResponse,
} from '@/lib/api/types';

/**
 * Server data, fetched in `app/(app)/billing/page.tsx`. The billing-detail
 * inputs are edited locally and written back with
 * `PATCH /api/billing/settings` — server values must not be copied into the
 * SF store, so the fields are seeded from props instead of `s.*`.
 */
export type BillingProps = {
  subscription: SubscriptionResponse;
  settings: BillingSettingsResponse;
  paymentMethods: PaymentMethodResponse[];
  upcoming: UpcomingInvoiceResponse;
  charges: ChargeResponse[];
};

export default function Billing({ subscription, settings, paymentMethods, upcoming, charges: chargeList }: BillingProps) {
  const { set, flash, accent } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);
  const input = inputStyle;
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11.5px' });

  /* Draft values for the billing-details form; the server owns the truth. */
  const [autopay, setAutopay] = useState(settings.autopay);
  const [billingEmail, setBillingEmail] = useState(settings.billing_email ?? '');
  const [taxId, setTaxId] = useState(settings.tax_id ?? '');
  const [cycle, setCycle] = useState(settings.cycle || 'monthly');

  const sub = toSubscriptionSummary(subscription, cycle);

  const patchSettings = (body: Parameters<typeof billingApi.updateSettings>[1], onFail: () => void) => {
    void billingApi.updateSettings(apiCall, body).then(res => {
      if (!res.ok) { flash('Could not save billing settings · ' + res.error.message); onFail(); return; }
      router.refresh();
    });
  };

  const subStatus = sub.statusLabel;
  const subPill = pill(subscriptionStatusTone(subscription.status));

  const subTiles = [
    { label:'SEATS', value: sub.seatsLicensed.toLocaleString('en-US'), meta: sub.seatsActivated.toLocaleString('en-US') + ' activated' },
    { label:'NEXT INVOICE', value: sub.nextInvoice, meta: sub.nextInvoiceMeta },
    { label:'CYCLE', value: sub.cycleLabel, meta: sub.cycleMeta },
  ];

  const paymentMethods_ = toPaymentMethodRows(paymentMethods).map(p => {
    const def = p.isDefault;
    return {
      id: p.id, brand: p.brand, label: p.label, meta: p.meta, isDefault: def, notDefault: !def,
      rowStyle: { display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid ' + (def ? '#c7d2fe' : '#eef1f6'), borderRadius:'12px', background: def ? '#f8faff' : '#fbfcfd' } as CSSProperties,
      brandStyle: { width:'46px', height:'30px', borderRadius:'7px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'9.5px', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 46px' } as CSSProperties,
      defaultPill: pill({ bg:'#eef2ff', fg:'#3730a3', bd:'#c7d2fe' }),
      onDefault: () => {
        flash(p.label + ' set as default payment method');
        void billingApi.setDefaultPaymentMethod(apiCall, p.id).then(res => {
          if (!res.ok) { flash('Could not change the default · ' + res.error.message); return; }
          router.refresh();
        });
      },
    };
  });

  const upcomingLines = toUpcomingLines(upcoming);

  const charges = toChargeRows(chargeList).map(c => ({
    id: c.id, amount: c.amount, meta: c.meta, status: c.status,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background: c.good ? '#10b981' : '#f59e0b', flex:'0 0 8px' } as CSSProperties,
    pill: pill(c.good ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' }),
  }));

  const autopayStr = autopay ? 'true' : 'false';
  const autopayRow: CSSProperties = { display:'inline-flex', alignItems:'center', gap:'9px', height:'32px', padding:'0 12px', borderRadius:'9px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer' };
  const autopaySwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: autopay ? '#10b981' : '#cbd5e1', position:'relative', flex:'0 0 34px' };
  const autopayKnob: CSSProperties = { position:'absolute', top:'2px', left: autopay ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' };
  const toggleAutopay = () => {
    const next = !autopay;
    setAutopay(next);
    flash('Autopay ' + (next ? 'enabled' : 'disabled'));
    patchSettings({ autopay: next }, () => setAutopay(!next));
  };

  const openCardModal = () => set({ modal: 'card' });
  const openCheckout = () => set({ modal: 'seats' });
  const openPlanChange = () => set({ modal: 'plan' });
  const goInvoices = () => go('invoices');

  const emptyNote: CSSProperties = { fontSize:'12.5px', color:'#64748b' };

  return (
    <section data-screen-label="Billing" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <span style={railHead}>Current subscription</span>
              <div style={{ display:'flex', alignItems:'baseline', gap:'9px' }}>
                <span style={{ fontSize:'22px', fontWeight:700, letterSpacing:'-.5px' }}>{sub.planName}</span>
                <span style={subPill}>{subStatus}</span>
              </div>
              <span style={{ fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{sub.metaLine}</span>
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
          {paymentMethods_.length ? null : (
            <div style={emptyNote}>No payment method on file — add one to enable autopay.</div>
          )}
          {paymentMethods_.map(p => (
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
          {upcomingLines.length ? null : (
            <div style={emptyNote}>No charges are scheduled for the next invoice.</div>
          )}
          {upcomingLines.map(l => (
            <div key={l.d} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'12.5px', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={{ color:'#334155' }}>{l.d}</span>
              <span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#0f172a', flex:'0 0 auto' }}>{l.amt}</span>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid #e3e7ee', paddingTop:'11px', fontSize:'14px', fontWeight:700 }}>
            <span>{upcomingTotalLabel(upcoming)}</span><span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{formatCents(upcoming.total_cents, upcoming.currency)}</span>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Billing details</div>
          <label style={lbl}>Billing email
            <input type="text" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)}
              onBlur={() => { if (billingEmail && billingEmail !== (settings.billing_email ?? '')) patchSettings({ billing_email: billingEmail }, () => setBillingEmail(settings.billing_email ?? '')); }}
              style={input} />
          </label>
          <label style={lbl}>Tax ID / VAT
            <input type="text" value={taxId} onChange={(e) => setTaxId(e.target.value)}
              onBlur={() => { if (taxId !== (settings.tax_id ?? '')) patchSettings({ tax_id: taxId }, () => setTaxId(settings.tax_id ?? '')); }}
              style={mono} />
          </label>
          <label style={lbl}>Billing cycle
            <select
              value={cycle}
              onChange={(e) => {
                const v = e.target.value === 'annual' ? 'annual' : 'monthly';
                const previous = cycle;
                setCycle(v);
                flash('Billing cycle → ' + (v === 'annual' ? 'annual (12% saved)' : 'monthly') + ' · prorated at next invoice');
                patchSettings({ cycle: v }, () => setCycle(previous));
              }}
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
          {charges.length ? null : (
            <div style={emptyNote}>No charges yet — the first invoice has not been collected.</div>
          )}
          {charges.map(c => (
            <div key={c.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
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
