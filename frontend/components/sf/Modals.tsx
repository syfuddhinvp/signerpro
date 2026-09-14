'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { useOptionalSession } from '@/components/sf/SessionProvider';
import { useModalBehaviour } from '@/components/sf/useModalBehaviour';
import { useNav } from '@/lib/sf/nav';
import {
  MODAL_COPY_STATIC, PAY_TITLES,
  TK_PRIO_LABEL
} from '@/lib/sf/data';
import SignatureComposer, { type ComposedSignature } from '@/components/sf/parts/SignatureComposer';
import { contactPathFor, pathFor } from '@/lib/sf/routes';
import { btn, inputStyle, lbl as lblStyle, TEXT_MUTED } from '@/lib/sf/ui';
import { useDocumentPersistence } from '@/lib/sf/builderInteractions';
import { apiCall } from '@/lib/api/browser';
import { account as accountApi, contacts as contactsApi, support as supportApi } from '@/lib/api/resources';
import type { SavedSignatureResponse } from '@/lib/api/types';
/* checkout / plan-change / seat-change / card branches (BIL) */
import {
  billing as billingApi,
  invoices as invoicesApi,
} from '@/lib/api/resources';
import {
  EMPTY,
  declineNotice,
  defaultPaymentMethodLabel,
  formatCents,
  toInvoiceRow,
  toPlanChoices,
  toPlanPreviewPairs,
  type InvoiceRow,
  type PlanChoice,
} from '@/lib/sf/adapters';
import type {
  CheckoutResponse,
  FieldResponse,
  RecipientResponse,
  PaymentMethodResponse,
  PlanChangePreview,
  SubscriptionResponse,
} from '@/lib/api/types';
import StripeCheckoutPanel, { stripeIsConfigured } from '@/components/sf/StripeCheckout';
import Icon from '@/components/sf/Icon';

/* There is no ACH tab any more: it existed only to collect a routing and
   account number in our own DOM. Bank debits are offered by Stripe inside the
   embedded session on the Card tab, where we never see the digits. */
const PAY_TABS: [string, string][] = [['card', 'Card / bank'], ['invoice', 'Invoice / PO']];
const CONTACT_ROLES: [string, string][] = [
  ['sign', 'Needs to sign'], ['approve', 'Approver'], ['copy', 'Receives a copy'], ['inperson', 'In-person signer']
];
const CONTACT_GROUPS: [string, string][] = [
  ['customers', 'Customers'], ['internal', 'Internal'], ['counsel', 'Counsel'], ['vendors', 'Vendors']
];
const TICKET_CATEGORIES: [string, string][] = [
  ['signing', 'Signing issue'], ['builder', 'Document preparation'], ['api', 'API / integration'],
  ['billing', 'Billing & invoices'], ['security', 'Security & compliance']
];
const TICKET_PRIORITIES: [string, string][] = [
  ['urgent', 'P1 · Urgent — signing blocked'], ['high', 'P2 · High'], ['normal', 'P3 · Normal'], ['low', 'P4 · Low']
];
/** Where Stripe sends the browser back to; the session id is appended by
    Stripe itself and confirmed server-side on arrival. */
function billingReturnUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location.origin + pathFor('billing', 'tenant');
}

/** Said when the server answered but produced no client secret — which means
    the backend is not on the Stripe provider, not that Stripe failed. */
const NO_EMBEDDED_SESSION =
  'The server did not return a Stripe session. Set BILLING_PROVIDER=stripe and STRIPE_SECRET_KEY in the backend environment.';

/** Stable empty arrays — the persistence hook re-seeds on identity change. */
const EMPTY_FIELD_ROWS: FieldResponse[] = [];
const EMPTY_RECIPIENT_ROWS: RecipientResponse[] = [];

const SLA_MAP: Record<string, string> = { urgent: '1h 00m left', high: '4h 00m left', normal: '1d 0h left', low: '3d 0h left' };

const textareaStyle: CSSProperties = {
  border: '1px solid #e3e7ee', borderRadius: '9px', padding: '8px 10px', fontSize: '.78125rem',
  resize: 'vertical', outline: 'none', width: '100%', color: '#0f172a'
};
const monoInput: CSSProperties = Object.assign({}, inputStyle, {
  fontFamily: 'var(--font-sans)', fontSize: '.71875rem'
});
const iconBtn: CSSProperties = {
  width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee',
  background: '#fff', cursor: 'pointer', color: '#475569', fontSize: '.8125rem', lineHeight: 1
};

export default function Modals() {
  const { s, set, flash, accent, recips, signable } = useSF();
  const { go, documentId } = useNav();
  const sessionName = useOptionalSession()?.name ?? '';
  const router = useRouter();
  const A = accent();

  const stateRef = useRef(s);
  stateRef.current = s;

  const closeModal = useCallback(() => set({ modal: null }), [set]);

  /* Modal behaviour (focus-in, tab trap, Escape, inert background, focus
     return) lives in `useModalBehaviour` so the public signing route shares
     this exact implementation rather than reimplementing it. */
  const dialogRef = useModalBehaviour<HTMLDivElement>(Boolean(s.modal), closeModal);

  /* The send confirmation is raised from the builder wizard and the header
     button, so the envelope it acts on is the document in the URL. Sending is
     the same `sendEnvelope` the workflow screen calls — it flushes pending
     field and routing edits first, POSTs `/api/documents/{id}/send`, and
     flashes the API's own message on failure. Field autosave stays off: this
     component never authors fields. */
  const persistence = useDocumentPersistence({
    documentId,
    serverFields: EMPTY_FIELD_ROWS,
    serverRecipients: EMPTY_RECIPIENT_ROWS,
    seededFields: s.fields,
    autosaveFields: false,
  });

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);

  /* `GET /api/me/signatures` — loaded when the adopt-signature modal opens. */
  const [savedSignatures, setSavedSignatures] = useState<SavedSignatureResponse[] | null>(null);
  const signatureModalOpen = s.modal === 'signature';
  /* The typed-signature preview must show the signer's own name, not the
     prototype's "Alex Rivera". */
  useEffect(() => {
    if (!signatureModalOpen) return;
    if (!s.typedName && sessionName) set({ typedName: sessionName });
  }, [signatureModalOpen, s.typedName, sessionName, set]);
  useEffect(() => {
    if (!signatureModalOpen) return;
    let cancelled = false;
    void accountApi.signatures(apiCall).then(res => {
      if (cancelled) return;
      setSavedSignatures(res.ok ? res.data : []);
    });
    return () => { cancelled = true; };
  }, [signatureModalOpen]);

  /* ── modal copy ── */
  const modalCopy: Record<string, [string, string, string, string]> = Object.assign({}, MODAL_COPY_STATIC, {
    send: [
      'Send for signature',
      'Review before the envelope leaves your workspace',
      (documentId ? 'Document ' + documentId + ' · ' : '') + s.fields.length + ' fields across ' + recips().length +
        ' recipients. Routing is ' + s.routing + ', reminders ' +
        (s.cadence === 'none' ? 'disabled' : 'every ' + s.cadence) + ', expiring in ' + s.expiry + ' days.',
      'Send envelope'
    ] as [string, string, string, string]
  });
  const mk = s.modal && modalCopy[s.modal] ? modalCopy[s.modal] : null;
  const payTitle = s.modal ? PAY_TITLES[s.modal] : undefined;

  const hasModal = !!s.modal;

  const modalLabel = (payTitle || (mk ? mk : ['Adopt your signature']))[0];
  const modalTitle = s.modal === 'signature' ? 'Adopt your signature' : (payTitle ? payTitle[0] : (mk ? mk[0] : ''));
  const modalSub = s.modal === 'signature'
    ? 'Draw, type, upload or re-use a saved signature'
    : (payTitle ? payTitle[1] : (mk ? mk[1] : ''));
  const modalBody = mk ? mk[2] : '';
  const modalCta = mk ? mk[3] : '';
  const modalCtaStyle = s.modal === 'decline' ? btn('#b91c1c', '#fff', '#b91c1c') : btn(A, '#fff', A);
  const modalCard: CSSProperties = {
    width: s.modal === 'signature' ? '680px' : (payTitle ? '560px' : '520px'),
    maxWidth: '100%', maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: '16px',
    boxShadow: '0 40px 90px -30px rgba(15,23,42,.6)', animation: 'sfIn .16s ease'
  };

  const isSigModal = s.modal === 'signature';
  const isTextModal = !!mk;
  const isContactModal = s.modal === 'contact';
  const isTicketModal = s.modal === 'ticket';
  const isCardModal = s.modal === 'card';
  const isCheckoutModal = s.modal === 'seats' || s.modal === 'plan' || s.modal === 'pay';

  /* ── signature ── */
  /* The composer itself lives in `parts/SignatureComposer` — the account page
     adopts signatures with the same panel. It fills `composeRef` with a reader
     for whatever the active tab holds. */
  const composeRef = useRef<(() => ComposedSignature | null) | null>(null);

  const adopt = () => {
    const st = stateRef.current;
    const id = st.activeSignField || ((signable().filter(f => f.type === 'signature')[0] || ({} as any)).id);
    const composed = composeRef.current ? composeRef.current() : null;
    if (!composed) return;  // the composer has already said what is missing
    const val = composed.signature_type === 'typed'
      ? 'typed:' + composed.type_face + ':' + composed.signature_text
      : composed.signature_image_base64;
    set(prev => ({ signValues: Object.assign({}, prev.signValues, { [id]: val }), modal: null }));
    flash('Signature applied · sealed with SHA-256 and logged');
  };

  /* ── contact ── */
  const createContact = () => {
    const n = s.newContact;
    if (!n.name.trim()) { flash('A name is required'); return; }
    if (n.email.indexOf('@') < 1) { flash('Enter a valid email'); return; }
    const name = n.name.trim();
    const email = n.email.trim();
    set({ modal: null, contactGroup: 'all',
      newContact: { name: '', company: '', email: '', title: '', role: 'sign', group: 'customers' } });
    flash('Saving ' + name + '…');
    /* The Contacts screen reads its rows from the API, so `router.refresh()` is
       what makes the new contact appear — there is no local mirror to seed. */
    void contactsApi
      .create(apiCall, {
        name,
        email,
        company: n.company.trim() || null,
        title: n.title.trim() || null,
        default_role: n.role,
        group: n.group,
        source: 'manual',
      })
      .then(res => {
        if (!res.ok) { flash('Could not save ' + name + ' · ' + res.error.message); return; }
        flash(name + ' saved');
        router.refresh();
        /* The record is a route now — go straight to it, the way the design
           lands you on a contact after you create it. */
        router.push(contactPathFor(res.data.id));
      });
  };

  /* ── ticket ── */
  const ntSlaNote = 'Enterprise SLA: P1 responded within 1 hour, 24/7. P3 within one business day.';
  /**
   * `POST /api/support/tickets`. The related-envelope input is a free-text
   * reference in the design; the API wants a document UUID, so only a value
   * that looks like one is sent — anything else is kept as a tag so the detail
   * the requester typed is not lost.
   */
  const createTicket = () => {
    const n = s.newTicket;
    if (!n.subject.trim()) { flash('A subject is required'); return; }
    const envelope = n.envelope.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(envelope);
    const tags = [n.category, TK_PRIO_LABEL[n.priority]].concat(envelope && !isUuid ? [envelope] : []);

    flash('Submitting ticket · ' + TK_PRIO_LABEL[n.priority] + ' · first response target ' + SLA_MAP[n.priority]);
    set({ modal: null, ticketFilter: 'all', newTicket: { subject: '', category: 'signing', priority: 'normal', envelope: '', body: '' } });

    void supportApi.create(apiCall, {
      subject: n.subject.trim(),
      body: n.body.trim() || 'No additional detail provided.',
      category: n.category,
      priority: n.priority,
      document_id: isUuid ? envelope : null,
      tags
    }).then(res => {
      if (!res.ok) { flash('Could not create the ticket · ' + res.error.message); return; }
      set({ openTicket: res.data.id, replyDraft: '' });
      flash(res.data.reference + ' created · ' + TK_PRIO_LABEL[res.data.priority] + (res.data.sla_label ? ' · first response target ' + res.data.sla_label : ''));
      router.refresh();
    });
  };

  /* ── payment / checkout ── */
  const payTabs = PAY_TABS.map(([id, label]) => {
    const on = s.payTab === id;
    return {
      id, label, selected: on,
      onClick: () => set({ payTab: id }),
      style: {
        flex: '1', height: '28px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '.78125rem',
        fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
        boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none'
      } as CSSProperties
    };
  });
  const savePaymentLabel = s.payTab === 'invoice' ? 'Request invoice billing' : 'Save payment method';

  /* Billing data for the card / checkout branches. Fetched through the session
     proxy when a modal opens; server data stays out of the SF store. */
  const [billingPlans, setBillingPlans] = useState<PlanChoice[]>([]);
  const [billingSub, setBillingSub] = useState<SubscriptionResponse | null>(null);
  const [billingPms, setBillingPms] = useState<PaymentMethodResponse[]>([]);
  const [planPreview, setPlanPreview] = useState<PlanChangePreview | null>(null);
  const [payInvoice, setPayInvoice] = useState<InvoiceRow | null>(null);

  const isBillingModal = s.modal === 'plan' || s.modal === 'seats' || s.modal === 'pay' || s.modal === 'card';
  useEffect(() => {
    if (!isBillingModal) return;
    let live = true;
    void Promise.all([
      billingApi.plans(apiCall),
      billingApi.subscription(apiCall),
      billingApi.paymentMethods(apiCall),
    ]).then(([plansRes, subRes, pmRes]) => {
      if (!live) return;
      if (plansRes.ok) setBillingPlans(toPlanChoices(plansRes.data));
      setBillingSub(subRes.ok ? subRes.data : null);
      if (pmRes.ok) setBillingPms(pmRes.data);
    });
    return () => { live = false; };
  }, [isBillingModal]);

  /* `s.checkoutPlan` is the display name the prototype stored; the API is
     addressed by plan code. */
  const targetPlan = billingPlans.find(p => p.name === s.checkoutPlan) ?? null;
  /* On the seats modal the preview is taken against the *current* plan: the
     proration is zero, but `remaining_fraction` is the same number the seat
     endpoint prorates with, so the figure shown is the figure charged. */
  const previewPlanCode = s.modal === 'plan'
    ? (targetPlan ? targetPlan.code : null)
    : (s.modal === 'seats' ? (billingSub ? billingSub.plan_code : null) : null);
  useEffect(() => {
    if (!previewPlanCode) { setPlanPreview(null); return; }
    let live = true;
    void billingApi.previewChangePlan(apiCall, { plan_code: previewPlanCode }).then(res => {
      if (live) setPlanPreview(res.ok ? res.data : null);
    });
    return () => { live = false; };
  }, [previewPlanCode]);

  /* ── embedded Stripe session (BIL / AUDIT §7 finding 3) ──
     The card fields live in Stripe's iframe, so all this component holds is
     the client secret that mounts it. `planCheckoutWanted` is what turns the
     plan summary into the payment frame; until the user asks for it, no
     session is created and nothing is charged. */
  const [stripeSession, setStripeSession] = useState<CheckoutResponse | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [planCheckoutWanted, setPlanCheckoutWanted] = useState(false);
  const stripeReady = stripeIsConfigured();

  useEffect(() => {
    /* A new modal is a new session. Reusing a stale client secret mounts a
       frame for a purchase the user already abandoned. */
    setStripeSession(null);
    setStripeError(null);
    setPlanCheckoutWanted(false);
  }, [s.modal]);

  const wantsSetupSession = isCardModal && s.payTab === 'card' && stripeReady;
  useEffect(() => {
    if (!wantsSetupSession) return;
    let live = true;
    void billingApi
      .setupSession(apiCall, { ui_mode: 'embedded', return_url: billingReturnUrl() })
      .then(res => {
        if (!live) return;
        if (!res.ok) { setStripeError(res.error.message); return; }
        if (!res.data.client_secret) { setStripeError(NO_EMBEDDED_SESSION); return; }
        setStripeSession(res.data);
      });
    return () => { live = false; };
  }, [wantsSetupSession]);

  const planCheckoutCode = planCheckoutWanted && targetPlan ? targetPlan.code : null;
  useEffect(() => {
    if (!planCheckoutCode || !stripeReady) return;
    let live = true;
    void billingApi
      .checkout(apiCall, {
        plan_code: planCheckoutCode,
        ui_mode: 'embedded',
        return_url: billingReturnUrl(),
      })
      .then(res => {
        if (!live) return;
        if (!res.ok) { setStripeError(res.error.message); return; }
        if (!res.data.client_secret) { setStripeError(NO_EMBEDDED_SESSION); return; }
        setStripeSession(res.data);
      });
    return () => { live = false; };
  }, [planCheckoutCode, stripeReady]);

  const payInvoiceId = s.modal === 'pay' ? s.openInvoice : '';
  useEffect(() => {
    if (!payInvoiceId) { setPayInvoice(null); return; }
    let live = true;
    void invoicesApi.get(apiCall, payInvoiceId).then(res => {
      if (live) setPayInvoice(res.ok ? toInvoiceRow(res.data) : null);
    });
    return () => { live = false; };
  }, [payInvoiceId]);

  /* The early exit lives *below* every hook. It used to sit ~280 lines above
     the five `useState`s and three `useEffect`s that follow, so opening a modal
     changed the hook count between renders and React threw
     "Rendered more hooks than during the previous render". */
  if (!hasModal) return null;

  const defaultPm = billingPms.find(pm => pm.is_default) ?? billingPms[0] ?? null;

  /* Only the invoice / PO branch is submitted from here: it carries no
     instrument at all, just a purchase-order number. A card is saved by the
     embedded Stripe session, which posts to Stripe and never to us. */
  const requestInvoiceBilling = () => {
    set({ modal: null });
    flash('Invoice billing requested · AR team notified');
    void billingApi.addPaymentMethod(apiCall, {
      type: 'invoice',
      provider_token: null,
      po_number: s.poNumber || null,
      make_default: true,
    }).then(res => {
      if (!res.ok) { flash('Could not save the payment method · ' + res.error.message); return; }
      if (s.poNumber) void billingApi.updateSettings(apiCall, { po_number: s.poNumber });
      router.refresh();
    });
  };

  const inv: InvoiceRow | null = payInvoice;
  const seatUnitCents = billingSub ? (billingSub.seat_price_cents ?? 0) : 0;
  const cycleMultiplier = billingSub && billingSub.cycle === 'annual' ? 12 : 1;
  const seatCostCents = seatUnitCents * cycleMultiplier * s.addSeats;
  const seatProrationCents = planPreview ? Math.round(seatCostCents * planPreview.remaining_fraction) : null;

  const planChoices = billingPlans.map(plan => ({
    name: plan.name, price: plan.priceLabel, selected: s.checkoutPlan === plan.name,
    onClick: () => set({ checkoutPlan: plan.name }),
    style: {
      display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start', padding: '11px',
      borderRadius: '11px', cursor: 'pointer',
      border: '1px solid ' + (s.checkoutPlan === plan.name ? A : '#e3e7ee'),
      background: s.checkoutPlan === plan.name ? '#eef2ff' : '#fbfcfd'
    } as CSSProperties
  }));

  const checkoutPairs: [string, string][] = s.modal === 'plan'
    ? (planPreview
        ? toPlanPreviewPairs(planPreview)
        : [
            ['Plan', s.checkoutPlan + (targetPlan ? ' · ' + targetPlan.priceLabel : '')],
            ['Seats', billingSub ? billingSub.seats_licensed.toLocaleString('en-US') : EMPTY],
            ['Prorated today', EMPTY],
            ['Next invoice', EMPTY]
          ])
    : s.modal === 'seats'
      ? [
          ['Additional seats', String(s.addSeats)],
          ['Unit price', seatUnitCents
            ? formatCents(seatUnitCents) + ' / seat / mo'
            : EMPTY],
          ['Prorated today', seatProrationCents === null ? EMPTY : formatCents(seatProrationCents)],
          ['Next invoice', billingSub ? formatCents(billingSub.next_invoice_total_cents + seatCostCents) : EMPTY]
        ]
      : [
          ['Invoice', inv ? inv.number : EMPTY],
          ['Amount due', inv ? formatCents(inv.amountDueCents, inv.currency) : EMPTY],
          ['Payment method', defaultPaymentMethodLabel(billingPms)],
          ['Settlement', 'immediate · Stripe']
        ];
  const checkoutLines = checkoutPairs.map(([k, v], i, arr) => ({
    k, v,
    style: {
      fontFamily: 'var(--font-sans)',
      fontWeight: i === arr.length - 1 ? 700 : 500,
      color: '#0f172a'
    } as CSSProperties
  }));
  const payMethodChip: CSSProperties = {
    padding: '5px 10px', borderRadius: '8px', border: '1px solid #e3e7ee', background: '#fbfcfd',
    fontSize: '.71875rem', fontFamily: 'var(--font-sans)', color: '#475569'
  };
  const payMethodLabel = defaultPaymentMethodLabel(billingPms);
  const checkoutCta = s.modal === 'pay'
    ? 'Pay ' + (inv ? formatCents(inv.amountDueCents, inv.currency) : EMPTY)
    : (s.modal === 'seats' ? 'Confirm & charge' : 'Switch plan');

  /* A 402 carries `decline_code` and the dunning state in its body, which
     `ApiError` does not keep — so the failed charge and the invoice are re-read
     and reported. A decline must never surface as a success toast. */
  const reportDecline = (row: InvoiceRow) => {
    void Promise.all([
      billingApi.charges(apiCall, { limit: 5 }),
      invoicesApi.get(apiCall, row.id),
    ]).then(([chargesRes, invRes]) => {
      const failed = chargesRes.ok
        ? chargesRes.data.find(c => c.invoice_id === row.id && c.status === 'failed')
        : undefined;
      flash(declineNotice(row.number, failed ? failed.decline_code : null, invRes.ok ? invRes.data.status : null));
      router.refresh();
    });
  };

  const confirmCheckout = () => {
    const m = s.modal;
    if (m === 'plan' && stripeReady) {
      if (!targetPlan) { flash(s.checkoutPlan + ' is not in the plan catalogue'); return; }
      /* The modal stays open and swaps to the payment frame. Nothing is
         charged until Stripe says so, and Stripe says so to the webhook and
         to the return-url confirmation — never to this click handler. */
      setStripeSession(null);
      setStripeError(null);
      setPlanCheckoutWanted(true);
      return;
    }
    set({ modal: null });
    if (m === 'pay') {
      if (!inv) { flash('That invoice could not be loaded · nothing was charged'); return; }
      const row = inv;
      flash('Charging ' + row.number + ' · ' + formatCents(row.amountDueCents, row.currency));
      void invoicesApi.pay(apiCall, row.id, defaultPm ? defaultPm.id : undefined).then(res => {
        if (!res.ok) {
          if (res.status === 402) { reportDecline(row); return; }
          flash('Could not pay ' + row.number + ' · ' + res.error.message);
          return;
        }
        flash(row.number + ' paid · ' + formatCents(row.totalCents, row.currency) + ' charged to ' + (res.data.payment_method_label || payMethodLabel));
        router.refresh();
      });
      return;
    }
    if (m === 'seats') {
      const delta = s.addSeats;
      flash(delta + ' seats added' + (seatProrationCents === null ? '' : ' · ' + formatCents(seatProrationCents) + ' proration calculated'));
      void billingApi.changeSeats(apiCall, delta).then(res => {
        if (!res.ok) { flash('Could not change seats · ' + res.error.message); return; }
        /* `change_seats` writes no Charge and no Invoice, so this must not
           claim money moved. It reports the licence change and the amount the
           backend calculated, and says the charge is not raised here. */
        flash(res.data.seats_licensed + ' seats licensed · ' + formatCents(res.data.proration_cents) + ' proration calculated (not charged)');
        router.refresh();
      });
      return;
    }
    if (!targetPlan) { flash(s.checkoutPlan + ' is not in the plan catalogue'); return; }
    const plan = targetPlan;
    void billingApi.changePlan(apiCall, plan.code).then(res => {
      if (!res.ok) { flash('Could not switch to ' + plan.name + ' · ' + res.error.message); return; }
      /* Reached only when Stripe is not configured in this browser build, so
         the change went through the local provider. Say that, rather than
         implying a card was charged. */
      flash('Plan switched to ' + plan.name + ' · no card payment was taken');
      router.refresh();
    });
  };

  /* ── text modal ── */
  const confirmModal = () => {
    const m = s.modal;
    set({ modal: null });
    if (m === 'decline') { flash('Signing declined · sender notified and audit trail updated'); go('audit'); }
    else if (m === 'reassign') flash('Envelope reassigned · original invitation revoked');
    else if (m === 'send') {
      // Real send: only on success does the signer view open. `sendEnvelope`
      // has already flashed the API's error message if it failed.
      void persistence.sendEnvelope().then(ok => { if (ok) go('sign', { documentId }); });
    }
    else flash('Disclosure accepted · consent recorded');
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={modalLabel}
      tabIndex={-1}
      data-sf-modal-open=""
      onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', padding: '24px' }}
    >
      <div style={modalCard}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', padding: '16px 18px', borderBottom: '1px solid #eef1f6' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>{modalTitle}</span>
            <span style={{ fontSize: '.75rem', color: '#64748b' }}>{modalSub}</span>
          </div>
          <button type="button" aria-label="Close" onClick={closeModal} style={iconBtn}><Icon name="close" size={13} /></button>
        </div>

        {isSigModal ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <SignatureComposer
              accent={A}
              composeRef={composeRef}
              savedSignatures={savedSignatures}
              onPickSaved={(row) => set({ typeFace: row.type_face || row.face || 'Caveat', typedName: row.signature_text || stateRef.current.typedName, sigTab: 'saved' })}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid #eef1f6', paddingTop: '13px' }}>
              <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, lineHeight: 1.5, maxWidth: '420px' }}>
                By selecting Adopt and sign, I agree this signature and initials are the electronic representation of my signature for all purposes.
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={closeModal} style={ghostBtn}>Cancel</button>
                <button type="button" onClick={adopt} style={primaryBtn}>Adopt and sign</button>
              </div>
            </div>
          </div>
        ) : null}

        {isContactModal ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
              <label style={lblStyle}>Full name
                <input type="text" value={s.newContact.name} onChange={(e) => { const v = e.target.value; set(st => ({ newContact: Object.assign({}, st.newContact, { name: v }) })); }} placeholder="Alex Rivera" style={inputStyle} />
              </label>
              <label style={lblStyle}>Company
                <input type="text" value={s.newContact.company} onChange={(e) => { const v = e.target.value; set(st => ({ newContact: Object.assign({}, st.newContact, { company: v }) })); }} placeholder="Acme Corporation" style={inputStyle} />
              </label>
            </div>
            <label style={lblStyle}>Email
              <input type="email" value={s.newContact.email} onChange={(e) => { const v = e.target.value; set(st => ({ newContact: Object.assign({}, st.newContact, { email: v }) })); }} placeholder="alex@acme.io" style={inputStyle} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
              <label style={lblStyle}>Job title
                <input type="text" value={s.newContact.title} onChange={(e) => { const v = e.target.value; set(st => ({ newContact: Object.assign({}, st.newContact, { title: v }) })); }} placeholder="VP Operations" style={inputStyle} />
              </label>
              <label style={lblStyle}>Default role
                <select value={s.newContact.role} onChange={(e) => { const v = e.target.value; set(st => ({ newContact: Object.assign({}, st.newContact, { role: v }) })); }} style={inputStyle}>
                  {CONTACT_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <label style={lblStyle}>Group
              <select value={s.newContact.group} onChange={(e) => { const v = e.target.value; set(st => ({ newContact: Object.assign({}, st.newContact, { group: v }) })); }} style={inputStyle}>
                {CONTACT_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
              <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, maxWidth: '280px', lineHeight: 1.5 }}>
                Contacts created here are returned by GET /v1/contacts and can be injected into an embed session.
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={closeModal} style={ghostBtn}>Cancel</button>
                <button type="button" onClick={createContact} style={primaryBtn}>Save contact</button>
              </div>
            </div>
          </div>
        ) : null}

        {isTicketModal ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={lblStyle}>Subject
              <input type="text" value={s.newTicket.subject} onChange={(e) => { const v = e.target.value; set(st => ({ newTicket: Object.assign({}, st.newTicket, { subject: v }) })); }} placeholder="Short summary of the issue" style={inputStyle} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
              <label style={lblStyle}>Category
                <select value={s.newTicket.category} onChange={(e) => { const v = e.target.value; set(st => ({ newTicket: Object.assign({}, st.newTicket, { category: v }) })); }} style={inputStyle}>
                  {TICKET_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={lblStyle}>Priority
                <select value={s.newTicket.priority} onChange={(e) => { const v = e.target.value; set(st => ({ newTicket: Object.assign({}, st.newTicket, { priority: v }) })); }} style={inputStyle}>
                  {TICKET_PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <label style={lblStyle}>Related envelope (optional)
              <input type="text" value={s.newTicket.envelope} onChange={(e) => { const v = e.target.value; set(st => ({ newTicket: Object.assign({}, st.newTicket, { envelope: v }) })); }} placeholder="ENV-2291-KD" style={monoInput} />
            </label>
            <label style={lblStyle}>Description
              <textarea rows={5} value={s.newTicket.body} onChange={(e) => { const v = e.target.value; set(st => ({ newTicket: Object.assign({}, st.newTicket, { body: v }) })); }} placeholder="What happened, what you expected, and any error text…" style={textareaStyle} />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
              <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, lineHeight: 1.5, maxWidth: '300px' }}>{ntSlaNote}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={closeModal} style={ghostBtn}>Cancel</button>
                <button type="button" onClick={createTicket} style={primaryBtn}>Submit ticket</button>
              </div>
            </div>
          </div>
        ) : null}

        {isCardModal ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <div style={{ display: 'flex', gap: '4px', background: '#f5f6f8', padding: '4px', borderRadius: '10px' }}>
              {payTabs.map(t => (
                <button key={t.id} type="button" onClick={t.onClick} aria-pressed={t.selected} style={t.style}>{t.label}</button>
              ))}
            </div>
            {s.payTab === 'card' ? (
              /* No card number, expiry, CVC or postal field lives here any
                 more. They are rendered by Stripe inside its own iframe, on
                 Stripe's origin, so this application cannot read them even by
                 accident (AUDIT_REPORT.md §7 finding 3). */
              <StripeCheckoutPanel
                clientSecret={stripeSession ? stripeSession.client_secret : null}
                error={stripeError}
                livemode={stripeSession ? stripeSession.livemode : undefined}
              />
            ) : null}
            {s.payTab === 'invoice' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={lblStyle}>Purchase order number
                  <input type="text" value={s.poNumber} onChange={(e) => set({ poNumber: e.target.value })} placeholder="PO-2026-0142" style={monoInput} />
                </label>
                <div style={{ fontSize: '.71875rem', color: '#64748b', lineHeight: 1.55 }}>
                  Invoice-based billing is available on Enterprise. Net 30 terms, remittance by wire or ACH credit.
                </div>
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
              <span style={{ fontSize: '.65625rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
                {s.payTab === 'card'
                  ? 'Card details are entered in Stripe\u2019s frame \u00b7 they never reach SignerPro'
                  : 'No card details are collected on this tab'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={closeModal} style={ghostBtn}>Cancel</button>
                {/* The Card tab has no submit of ours: Stripe's own button in
                    the frame submits, then redirects to the return url. */}
                {s.payTab === 'invoice' ? (
                  <button type="button" onClick={requestInvoiceBilling} style={primaryBtn}>{savePaymentLabel}</button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {isCheckoutModal && planCheckoutWanted ? (
          /* The plan modal, once the user has asked to pay: the summary is
             replaced by Stripe's frame rather than sitting above a second
             "confirm" button that would take a payment we cannot see. */
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <StripeCheckoutPanel
              clientSecret={stripeSession ? stripeSession.client_secret : null}
              error={stripeError}
              livemode={stripeSession ? stripeSession.livemode : undefined}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
              <button type="button" onClick={closeModal} style={ghostBtn}>Cancel</button>
            </div>
          </div>
        ) : null}

        {isCheckoutModal && !planCheckoutWanted ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
            {s.modal === 'plan' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '9px' }}>
                {planChoices.map(p => (
                  <button key={p.name} type="button" onClick={p.onClick} aria-pressed={p.selected} style={p.style}>
                    <span style={{ fontSize: '.8125rem', fontWeight: 700 }}>{p.name}</span>
                    <span style={{ fontSize: '.71875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>{p.price}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {s.modal === 'seats' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                <label style={lblStyle}>Additional seats
                  <input
                    type="range" min="0" max="500" step="10"
                    value={String(s.addSeats)}
                    onChange={(e) => set({ addSeats: parseInt(e.target.value, 10) })}
                    aria-label="Additional seats"
                    style={{ width: '100%', accentColor: '#4f46e5' }}
                  />
                </label>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78125rem' }}>
                  <span style={{ color: '#64748b' }}>{String(s.addSeats)} seats added</span>
                  <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 600 }}>{formatCents(seatCostCents)}</span>
                </div>
              </div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid #eef1f6', borderRadius: '12px', padding: '12px', background: '#fbfcfd' }}>
              {checkoutLines.map(l => (
                <div key={l.k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78125rem' }}>
                  <span style={{ color: '#64748b' }}>{l.k}</span><span style={l.style}>{l.v}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={payMethodChip}>{payMethodLabel}</span>
              <button type="button" onClick={() => set({ modal: 'card' })} style={ghostBtn}>Change</button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={closeModal} style={ghostBtn}>Cancel</button>
                <button type="button" onClick={confirmCheckout} style={primaryBtn}>{checkoutCta}</button>
              </div>
            </div>
          </div>
        ) : null}

        {isTextModal ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <div style={{ fontSize: '.78125rem', color: '#475569', lineHeight: 1.65, maxHeight: '240px', overflow: 'auto' }}>{modalBody}</div>
            {s.modal === 'decline' ? (
              <textarea
                rows={3}
                value={s.declineReason}
                onChange={(e) => set({ declineReason: e.target.value })}
                aria-label="Reason"
                placeholder="Reason shared with the sender…"
                style={textareaStyle}
              />
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button type="button" onClick={closeModal} style={ghostBtn}>Close</button>
              <button type="button" onClick={confirmModal} style={modalCtaStyle}>{modalCta}</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
