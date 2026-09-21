'use client';

import { Suspense, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { btn, pill, railHead, lbl, inputStyle, BORDER_STRONG } from '@/lib/sf/ui';
import CheckoutReturn from '@/components/sf/CheckoutReturn';
import { apiCall } from '@/lib/api/browser';
import { billing as billingApi } from '@/lib/api/resources';
import {
  formatCents,
  formatDate,
  subscriptionStatusTone,
  toChargeRows,
  toPaymentMethodRows,
  toSubscriptionSummary,
  toUpcomingLines,
  upcomingTotalLabel,
} from '@/lib/sf/adapters';
import Icon from '@/components/sf/Icon';
import type {
  BillingSettingsResponse,
  ChargeResponse,
  PaymentMethodResponse,
  SubscriptionResponse,
  UpcomingInvoiceResponse,
  Wallet,
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
  /** Account balance (BIL-12). Spent on invoices; never paid out. */
  wallet: Wallet;
};

export default function Billing({ subscription, settings, paymentMethods, upcoming, charges: chargeList, wallet }: BillingProps) {
  const { set, flash, accent } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();

  const ghostBtn = btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))');
  const primaryBtn = btn(A, 'hsl(var(--color-fg-on-solid))', A);
  const input = inputStyle;
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:'var(--font-sans)', fontSize:'.71875rem' });

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

  /* Each saved method is drawn as a physical card face: brand-tinted plate,
     chip, masked number, holder and expiry — so a wallet of several methods
     reads at a glance instead of as three identical rows. */
  const cardFace = (brand: string): CSSProperties => {
    const b = brand.toLowerCase();
    const plate =
      b.startsWith('visa') ? 'linear-gradient(135deg,#1a1f71,#2a3fb8 55%,#4356d6)'
      : b.startsWith('maste') || b.startsWith('mc') ? 'linear-gradient(135deg,#231f20,#7a2a12 55%,#eb001b)'
      : b.startsWith('amex') ? 'linear-gradient(135deg,#0b6b53,#0f8f6c 55%,#2ec49a)'
      : b.startsWith('disco') ? 'linear-gradient(135deg,#2b2b2b,#8a4a12 55%,#f76b1c)'
      : 'linear-gradient(135deg,#0f172a,#243044 55%,#3d4c66)';
    return {
      position:'relative', overflow:'hidden', width:'100%', maxWidth:'320px', aspectRatio:'1.586',
      borderRadius:'14px', padding:'14px', color:'hsl(var(--color-fg-on-solid))', background: plate,
      boxShadow:'0 10px 22px -12px rgba(15,23,42,.55)',
      display:'flex', flexDirection:'column', justifyContent:'space-between',
    };
  };
  const cardSheen: CSSProperties = { position:'absolute', inset:'-40% -20% auto -20%', height:'140%', background:'radial-gradient(60% 60% at 20% 10%, rgba(255,255,255,.22), transparent 70%)', pointerEvents:'none' };
  const cardChip: CSSProperties = { width:'34px', height:'25px', borderRadius:'5px', background:'linear-gradient(135deg,#f7e39b,#c9a227)', border:'1px solid rgba(0,0,0,.18)', flex:'0 0 34px' };
  const cardBrand: CSSProperties = { fontSize:'.8125rem', fontWeight:800, letterSpacing:'.06em', fontFamily:'var(--font-sans)', flex:'0 1 auto', textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' };
  const cardNumber: CSSProperties = { fontSize:'.9375rem', fontWeight:600, letterSpacing:'.1em', fontFamily:'var(--font-sans)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' };
  const cardCaption: CSSProperties = { fontSize:'.53125rem', letterSpacing:'.11em', color:'rgba(248,250,252,.62)', fontFamily:'var(--font-sans)' };
  const cardValue: CSSProperties = { fontSize:'.6875rem', fontWeight:600, letterSpacing:'.06em', fontFamily:'var(--font-sans)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' };
  const cardDefaultPill: CSSProperties = { display:'inline-flex', alignItems:'center', height:'20px', padding:'0 8px', borderRadius:'99px', fontSize:'.59375rem', fontWeight:700, letterSpacing:'.06em', background:'rgba(255,255,255,.18)', border:'1px solid rgba(255,255,255,.35)', color:'hsl(var(--color-fg-on-solid))', flex:'0 0 auto' };
  const cardDefaultBtn: CSSProperties = { height:'26px', padding:'0 10px', borderRadius:'99px', fontSize:'.65625rem', fontWeight:600, cursor:'pointer', background:'rgba(255,255,255,.14)', border:'1px solid rgba(255,255,255,.35)', color:'hsl(var(--color-fg-on-solid))', flex:'0 0 auto',
    display:'inline-flex', alignItems:'center', gap:'4px' };

  const paymentMethods_ = toPaymentMethodRows(paymentMethods).map(p => ({
    id: p.id, brand: p.brand, label: p.label, number: p.number, expiry: p.expiry, holder: p.holder,
    isDefault: p.isDefault, notDefault: !p.isDefault,
    faceStyle: Object.assign(cardFace(p.brand), p.isDefault ? { outline:'2px solid ' + A, outlineOffset:'2px' } : {}),
    onDefault: () => {
      flash(p.label + ' set as default payment method');
      void billingApi.setDefaultPaymentMethod(apiCall, p.id).then(res => {
        if (!res.ok) { flash('Could not change the default · ' + res.error.message); return; }
        router.refresh();
      });
    },
  }));

  const upcomingLines = toUpcomingLines(upcoming);

  const charges = toChargeRows(chargeList).map(c => ({
    id: c.id, amount: c.amount, meta: c.meta, status: c.status,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background: c.good ? 'hsl(var(--color-highlight-solid))' : 'hsl(var(--color-bg-warning-solid))', flex:'0 0 8px' } as CSSProperties,
    pill: pill(c.good ? { bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' } : { bg:'hsl(var(--color-bg-warning-subtle))', fg:'hsl(var(--color-fg-warning))', bd:'hsl(var(--color-border-warning))' }),
  }));

  const autopayStr = autopay ? 'true' : 'false';
  const autopayRow: CSSProperties = { display:'inline-flex', alignItems:'center', gap:'9px', height:'32px', padding:'0 12px', borderRadius:'9px', border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))', cursor:'pointer' };
  const autopaySwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: autopay ? 'hsl(var(--color-highlight-solid))' : BORDER_STRONG, position:'relative', flex:'0 0 34px' };
  const autopayKnob: CSSProperties = { position:'absolute', top:'2px', left: autopay ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'hsl(var(--color-bg-surface))', transition:'left .15s' };
  const toggleAutopay = () => {
    const next = !autopay;
    setAutopay(next);
    flash('Autopay ' + (next ? 'enabled' : 'disabled'));
    patchSettings({ autopay: next }, () => setAutopay(!next));
  };

  const openCardModal = () => set({ modal: 'card' });
  const openCheckout = () => set({ modal: 'seats' });
  const openPlanChange = () => set({ modal: 'plan' });
  const keepCurrentPlan = () => {
    void billingApi.cancelPendingPlanChange(apiCall).then(res => {
      if (!res.ok) { flash('Could not cancel the scheduled change · ' + res.error.message); return; }
      flash('Scheduled change cancelled · staying on ' + res.data.plan_name);
      router.refresh();
    });
  };

  const goInvoices = () => go('invoices');

  const emptyNote: CSSProperties = { fontSize:'.78125rem', color:'hsl(var(--color-fg-muted))' };

  return (
    <section data-screen-label="Billing" style={{ padding:'22px 22px 40px', maxWidth:'1180px', margin:'0 auto', width:'100%', display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
      {/* Stripe redirects back to /billing?session_id=… ; this confirms the
          session with the provider before anything is claimed. `useSearchParams`
          needs a Suspense boundary to keep the page statically renderable. */}
      <Suspense fallback={null}><CheckoutReturn /></Suspense>
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <span style={railHead}>Current subscription</span>
              <div style={{ display:'flex', alignItems:'baseline', gap:'9px' }}>
                <span style={{ fontSize:'1.375rem', fontWeight:700, letterSpacing:'-.5px' }}>{sub.planName}</span>
                <span style={subPill}>{subStatus}</span>
              </div>
              <span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>{sub.metaLine}</span>
            </div>
            <div style={{ display:'flex', gap:'8px', flex:'0 0 auto' }}>
              <button type="button" onClick={openPlanChange} style={ghostBtn}><Icon name="settings" size={13} />Change plan</button>
              <button type="button" onClick={openCheckout} style={primaryBtn}><Icon name="addUser" size={13} />Add seats</button>
            </div>
          </div>
          {subscription.pending_plan_code ? (
            /* The plan has NOT changed yet. Saying so plainly, with the date
               and a way out, is the whole point of scheduling it. */
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap', border:'1px solid hsl(var(--color-border-info))', background:'hsl(var(--color-bg-info-subtle))', borderRadius:'12px', padding:'11px 12px' }}>
              <span style={{ fontSize:'.78125rem', color:'hsl(var(--color-fg-info))' }}>
                {subscription.pending_plan_name} starts {formatDate(subscription.pending_plan_effective_at)}
                {' · you keep ' + subscription.plan_name + ' until then'}
              </span>
              <button type="button" onClick={keepCurrentPlan} style={ghostBtn}>
                <Icon name="close" size={13} />Keep {subscription.plan_name}
              </button>
            </div>
          ) : null}
          {wallet.balance_cents > 0 ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap', border:'1px solid hsl(var(--color-border-success))', background:'hsl(var(--color-bg-success-subtle))', borderRadius:'12px', padding:'11px 12px' }}>
              <span style={{ fontSize:'.78125rem', color:'hsl(var(--color-fg-success))' }}>
                {formatCents(wallet.balance_cents, wallet.currency)} account balance
                {' · applied to your next invoice before any card is charged'}
              </span>
            </div>
          ) : null}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'11px' }}>
            {subTiles.map(t => (
              <div key={t.label} style={{ border:'1px solid hsl(var(--color-border-hairline))', borderRadius:'12px', padding:'12px', background:'hsl(var(--color-bg-subtle))', display:'flex', flexDirection:'column', gap:'5px' }}>
                <span style={{ fontSize:'.65625rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)', letterSpacing:'.05em' }}>{t.label}</span>
                <span style={{ fontSize:'1.0625rem', fontWeight:700, letterSpacing:'-.4px' }}>{t.value}</span>
                <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))' }}>{t.meta}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'13px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>Payment methods</div>
          </div>
          {paymentMethods_.length ? null : (
            <div style={emptyNote}>No payment method on file — add one to enable autopay.</div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:'12px' }}>
            {paymentMethods_.map(p => (
              <div key={p.id} style={p.faceStyle}>
                <span style={cardSheen} aria-hidden="true"></span>
                <div style={{ position:'relative', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'10px' }}>
                  <span style={cardChip} aria-hidden="true"></span>
                  {p.isDefault ? (<span style={cardDefaultPill}>DEFAULT</span>) : null}
                  {p.notDefault ? (
                    <button type="button" onClick={p.onDefault} style={cardDefaultBtn}><Icon name="check" size={11} />Make default</button>
                  ) : null}
                </div>
                <div style={{ position:'relative', display:'flex', flexDirection:'column', gap:'3px' }}>
                  <span style={cardNumber}>{p.number || p.label}</span>
                  {p.number ? (<span style={cardCaption}>{p.label}</span>) : null}
                </div>
                <div style={{ position:'relative', display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:'10px' }}>
                  <span style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={cardCaption}>CARD HOLDER</span>
                    <span style={cardValue}>{p.holder}</span>
                  </span>
                  <span style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'0 0 auto' }}>
                    <span style={cardCaption}>VALID THRU</span>
                    <span style={cardValue}>{p.expiry}</span>
                  </span>
                  <span style={cardBrand}>{p.brand}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <button type="button" onClick={openCardModal} style={primaryBtn}><Icon name="card" size={13} />Add payment method</button>
            <button type="button" role="switch" aria-checked={autopayStr === 'true'} onClick={toggleAutopay} style={autopayRow}>
              <span style={{ fontSize:'.78125rem', color:'hsl(var(--color-fg-subtle))' }}>Autopay</span>
              <span style={autopaySwitch}><span style={autopayKnob}></span></span>
            </button>
          </div>
        </div>

        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={railHead}>Upcoming invoice · preview</div>
          {upcomingLines.length ? null : (
            <div style={emptyNote}>No charges are scheduled for the next invoice.</div>
          )}
          {upcomingLines.map(l => (
            <div key={l.d} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'.78125rem', padding:'7px 0', borderTop:'1px solid hsl(var(--color-border-faint))' }}>
              <span style={{ color:'hsl(var(--color-fg-subtle))' }}>{l.d}</span>
              <span style={{ fontFamily:'var(--font-sans)', color:'hsl(var(--color-fg-default))', flex:'0 0 auto' }}>{l.amt}</span>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid hsl(var(--color-border-subtle))', paddingTop:'11px', fontSize:'.875rem', fontWeight:700 }}>
            <span>{upcomingTotalLabel(upcoming)}</span><span style={{ fontFamily:'var(--font-sans)' }}>{formatCents(upcoming.total_cents, upcoming.currency)}</span>
          </div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
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
          <div style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.55 }}>Invoices are issued from SignerPro Inc., 400 Market St, San Francisco. Reverse-charge applies for EU VAT-registered entities.</div>
        </div>
        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Recent charges</div>
          {charges.length ? null : (
            <div style={emptyNote}>No charges yet — the first invoice has not been collected.</div>
          )}
          {charges.map(c => (
            <div key={c.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderTop:'1px solid hsl(var(--color-border-faint))' }}>
              <span style={c.dot}></span>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{c.amount}</span>
                <span style={{ fontSize:'.65625rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.meta}</span>
              </div>
              <span style={c.pill}>{c.status}</span>
            </div>
          ))}
          <button type="button" onClick={goInvoices} style={ghostBtn}><Icon name="file" size={13} />All invoices &amp; receipts</button>
        </div>
        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:'8px' }}>
            <div style={railHead}>Account balance</div>
            <span style={{ fontSize:'.9375rem', fontWeight:700, letterSpacing:'-.3px' }}>
              {formatCents(wallet.balance_cents, wallet.currency)}
            </span>
          </div>
          {/* Said once, here, rather than left for a support ticket to answer:
              this is credit, not money held on the tenant's behalf. */}
          <div style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.55 }}>
            Applied to your invoices automatically, before any card is charged. Balance is not refundable to a card or bank account.
          </div>
          {wallet.entries.length ? null : (
            <div style={emptyNote}>No balance activity yet.</div>
          )}
          {wallet.entries.map(entry => (
            <div key={entry.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderTop:'1px solid hsl(var(--color-border-faint))' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                <span style={{ fontSize:'.78125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{entry.description}</span>
                <span style={{ fontSize:'.65625rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>{formatDate(entry.created_at)}</span>
              </div>
              <span style={{ fontSize:'.78125rem', fontWeight:700, fontFamily:'var(--font-sans)', color: entry.amount_cents < 0 ? 'hsl(var(--color-fg-muted))' : '#166534' }}>
                {(entry.amount_cents < 0 ? '−' : '+') + formatCents(Math.abs(entry.amount_cents), entry.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
