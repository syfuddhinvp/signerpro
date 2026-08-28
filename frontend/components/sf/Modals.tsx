'use client';

import React, { useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useSF, invoicesScoped } from '@/lib/sf/state';
import {
  SIG_TABS, TYPE_FACES, SAVED_SIGS, INKS, MODAL_COPY_STATIC, PAY_TITLES,
  PLAN_PRICES, GROUP_LABELS, TK_PRIO_LABEL, INVOICES
} from '@/lib/sf/data';
import { btn, inputStyle, lbl as lblStyle } from '@/lib/sf/ui';

const PAY_TABS: [string, string][] = [['card', 'Card'], ['ach', 'ACH / SEPA'], ['invoice', 'Invoice / PO']];
const CONTACT_PALETTE = ['#10b981', '#6366f1', '#f59e0b', '#0ea5e9', '#8b5cf6', '#14b8a6', '#f43f5e'];
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
const SLA_MAP: Record<string, string> = { urgent: '1h 00m left', high: '4h 00m left', normal: '1d 0h left', low: '3d 0h left' };

const textareaStyle: CSSProperties = {
  border: '1px solid #e3e7ee', borderRadius: '9px', padding: '8px 10px', fontSize: '12.5px',
  resize: 'vertical', outline: 'none', width: '100%', color: '#0f172a'
};
const monoInput: CSSProperties = Object.assign({}, inputStyle, {
  fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontSize: '11.5px'
});
const iconBtn: CSSProperties = {
  width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee',
  background: '#fff', cursor: 'pointer', color: '#475569', fontSize: '13px', lineHeight: 1
};

export default function Modals() {
  const { s, set, flash, accent, recips, money, isPlat, signable } = useSF();
  const A = accent();
  const plat = isPlat();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasStrokes = useRef(false);
  const stateRef = useRef(s);
  stateRef.current = s;

  const closeModal = useCallback(() => set({ modal: null }), [set]);

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);

  /* ── modal copy ── */
  const modalCopy: Record<string, [string, string, string, string]> = Object.assign({}, MODAL_COPY_STATIC, {
    send: [
      'Send for signature',
      'Review before the envelope leaves your workspace',
      'ENV-2291-KD · 3 pages · ' + s.fields.length + ' fields across ' + recips().length +
        ' recipients. Routing is ' + s.routing + ', reminders ' +
        (s.cadence === 'none' ? 'disabled' : 'every ' + s.cadence) + ', expiring in ' + s.expiry + ' days.',
      'Send envelope'
    ] as [string, string, string, string]
  });
  const mk = s.modal && modalCopy[s.modal] ? modalCopy[s.modal] : null;
  const payTitle = s.modal ? PAY_TITLES[s.modal] : undefined;

  const hasModal = !!s.modal;
  if (!hasModal) return null;

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
  const sigTabs = SIG_TABS.map(([id, label]) => {
    const on = s.sigTab === id;
    return {
      id, label, selected: on,
      onClick: () => set({ sigTab: id }),
      style: {
        flex: '1', height: '30px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12.5px',
        fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
        boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none'
      } as CSSProperties
    };
  });
  const typeFaces = TYPE_FACES.map(name => {
    const on = s.typeFace === name;
    return {
      name, selected: on,
      onClick: () => set({ typeFace: name }),
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', padding: '12px 8px',
        borderRadius: '11px', cursor: 'pointer', border: '1px solid ' + (on ? A : '#e3e7ee'),
        background: on ? '#eef2ff' : '#fbfcfd'
      } as CSSProperties,
      preview: {
        fontFamily: "'" + name + "', cursive", fontSize: '26px', color: '#0f172a', lineHeight: 1.1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%'
      } as CSSProperties
    };
  });
  const savedSigs = SAVED_SIGS.map(x => ({
    name: s.typedName, label: x.label, meta: x.meta,
    onClick: () => set({ typeFace: x.face, sigTab: 'saved' }),
    style: {
      display: 'flex', alignItems: 'center', gap: '14px', padding: '11px 13px', borderRadius: '12px',
      border: '1px solid #e3e7ee', background: '#fbfcfd', cursor: 'pointer', width: '100%'
    } as CSSProperties,
    preview: { fontFamily: "'" + x.face + "', cursive", fontSize: '26px', color: '#0f172a' } as CSSProperties
  }));
  const inks = INKS.map(([c, aria]) => ({
    c, aria,
    onClick: () => set({ sigInk: c }),
    style: {
      width: '22px', height: '22px', borderRadius: '99px', background: c, cursor: 'pointer',
      border: s.sigInk === c ? '2px solid ' + A : '2px solid #e3e7ee',
      boxShadow: s.sigInk === c ? '0 0 0 2px #fff inset' : 'none'
    } as CSSProperties
  }));

  const initCanvas = (el: HTMLCanvasElement) => {
    canvasRef.current = el;
    hasStrokes.current = false;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let drawing = false;
    let pts: { x: number; y: number }[] = [];
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (el.width / r.width), y: (e.clientY - r.top) * (el.height / r.height) };
    };
    el.onpointerdown = (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drawing = true;
      pts = [pos(e)];
      hasStrokes.current = true;
    };
    el.onpointermove = (e) => {
      if (!drawing) return;
      pts.push(pos(e));
      ctx.strokeStyle = stateRef.current.sigInk;
      ctx.lineWidth = stateRef.current.sigStroke * 2.2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.stroke();
    };
    el.onpointerup = () => { drawing = false; pts = []; };
  };
  const onCanvasRef = (el: HTMLCanvasElement | null) => {
    if (el && el !== canvasRef.current) initCanvas(el);
  };
  const clearCanvas = () => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, el.width, el.height);
    hasStrokes.current = false;
  };
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ uploadSrc: reader.result as string });
    reader.readAsDataURL(file);
  };
  const adopt = () => {
    const st = stateRef.current;
    const id = st.activeSignField || ((signable().filter(f => f.type === 'signature')[0] || ({} as any)).id);
    let val: string | null = null;
    if (st.sigTab === 'draw') {
      val = canvasRef.current && hasStrokes.current ? canvasRef.current.toDataURL('image/png') : null;
      if (!val) { flash('Draw your signature first'); return; }
    } else if (st.sigTab === 'type') {
      val = 'typed:' + st.typeFace + ':' + st.typedName;
    } else if (st.sigTab === 'upload') {
      if (!st.uploadSrc) { flash('Upload an image first'); return; }
      val = st.uploadSrc;
    } else {
      val = 'typed:' + st.typeFace + ':' + st.typedName;
    }
    set(prev => ({ signValues: Object.assign({}, prev.signValues, { [id]: val }), modal: null }));
    flash('Signature applied · sealed with SHA-256 and logged');
  };

  /* ── contact ── */
  const createContact = () => {
    const n = s.newContact;
    if (!n.name.trim()) { flash('A name is required'); return; }
    if (n.email.indexOf('@') < 1) { flash('Enter a valid email'); return; }
    const id = 'ct' + (s.contacts.length + 1);
    const c: any = {
      id, name: n.name.trim(), email: n.email.trim(), company: n.company.trim() || '—', title: n.title.trim() || '—',
      phone: '—', role: n.role, group: n.group, source: 'Manual', tags: [GROUP_LABELS[n.group]], envelopes: 0,
      lastSigned: '—', color: CONTACT_PALETTE[s.contacts.length % CONTACT_PALETTE.length]
    };
    set(st => ({
      contacts: [c].concat(st.contacts as any[]) as any, openContact: id, modal: null, contactGroup: 'all',
      newContact: { name: '', company: '', email: '', title: '', role: 'sign', group: 'customers' }
    }));
    flash(c.name + ' saved · available via GET /v1/contacts');
  };

  /* ── ticket ── */
  const ntSlaNote = 'Enterprise SLA: P1 responded within 1 hour, 24/7. P3 within one business day.';
  const createTicket = () => {
    const n = s.newTicket;
    if (!n.subject.trim()) { flash('A subject is required'); return; }
    const id = 'SF-' + (4472 + s.tickets.length);
    const t: any = {
      id, subject: n.subject.trim(), slug: plat ? 'acme' : 'acme', tenant: 'Acme Corporation',
      requester: plat ? 'Support (proxy)' : 'Priya Raman', requesterEmail: 'priya@acme.io',
      category: n.category, priority: n.priority, status: 'open', assignee: 'ag1',
      envelope: n.envelope.trim(), created: '28 Aug 12:04', sla: SLA_MAP[n.priority],
      tags: [n.category, TK_PRIO_LABEL[n.priority]],
      messages: [{
        author: plat ? 'Support (proxy)' : 'Priya Raman',
        role: plat ? 'Support engineer · SignForge' : 'Org admin · Acme',
        ts: '28 Aug 12:04', internal: false, side: plat ? 'agent' : 'customer',
        body: n.body.trim() || 'No additional detail provided.'
      }]
    };
    set(st => ({
      tickets: [t].concat(st.tickets as any[]) as any, openTicket: id, modal: null, ticketFilter: 'all',
      newTicket: { subject: '', category: 'signing', priority: 'normal', envelope: '', body: '' }
    }));
    flash(id + ' created · ' + TK_PRIO_LABEL[n.priority] + ' · first response target ' + SLA_MAP[n.priority]);
  };

  /* ── payment / checkout ── */
  const payTabs = PAY_TABS.map(([id, label]) => {
    const on = s.payTab === id;
    return {
      id, label, selected: on,
      onClick: () => set({ payTab: id }),
      style: {
        flex: '1', height: '28px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '12.5px',
        fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
        boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none'
      } as CSSProperties
    };
  });
  const savePaymentLabel = s.payTab === 'invoice' ? 'Request invoice billing' : 'Save payment method';
  const savePayment = () => {
    if (s.payTab === 'card' && s.card.number.replace(/\s/g, '').length < 12) {
      flash('Enter a valid card number (try 4242 4242 4242 4242)');
      return;
    }
    set({ modal: null });
    flash(s.payTab === 'card'
      ? 'Card tokenised · pm_1QhT… saved and set as default'
      : (s.payTab === 'ach' ? 'Bank account saved · instant verification passed' : 'Invoice billing requested · AR team notified'));
  };

  const scoped = invoicesScoped(plat);
  const inv: any = INVOICES.find(i => i.number === s.openInvoice) || scoped[0] || INVOICES[0];
  const seatCost = s.addSeats * 44;

  const planChoices = ['Team', 'Business', 'Enterprise'].map(name => ({
    name, price: PLAN_PRICES[name], selected: s.checkoutPlan === name,
    onClick: () => set({ checkoutPlan: name }),
    style: {
      display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start', padding: '11px',
      borderRadius: '11px', cursor: 'pointer',
      border: '1px solid ' + (s.checkoutPlan === name ? A : '#e3e7ee'),
      background: s.checkoutPlan === name ? '#eef2ff' : '#fbfcfd'
    } as CSSProperties
  }));

  const checkoutPairs: [string, string][] = s.modal === 'plan'
    ? [
        ['Plan', s.checkoutPlan + ' · ' + PLAN_PRICES[s.checkoutPlan]],
        ['Seats', '1,240'],
        ['Prorated today', money(s.checkoutPlan === 'Enterprise' ? 0 : 12480)],
        ['Next invoice', money(s.checkoutPlan === 'Enterprise' ? 41196 : 34720)]
      ]
    : s.modal === 'seats'
      ? [
          ['Additional seats', String(s.addSeats)],
          ['Unit price', '$44 / seat / mo'],
          ['Prorated today', money(Math.round(seatCost * 0.13))],
          ['Next invoice', money(41196 + seatCost)]
        ]
      : [
          ['Invoice', inv.number],
          ['Amount due', money(inv.total)],
          ['Payment method', inv.method],
          ['Settlement', 'immediate · Stripe']
        ];
  const checkoutLines = checkoutPairs.map(([k, v], i, arr) => ({
    k, v,
    style: {
      fontFamily: "'Inter', 'Google Sans Flex', sans-serif",
      fontWeight: i === arr.length - 1 ? 700 : 500,
      color: '#0f172a'
    } as CSSProperties
  }));
  const payMethodChip: CSSProperties = {
    padding: '5px 10px', borderRadius: '8px', border: '1px solid #e3e7ee', background: '#fbfcfd',
    fontSize: '11.5px', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: '#475569'
  };
  const payMethodLabel = s.defaultPm === 'pm_visa' ? 'Visa •••• 4242' : 'Wells Fargo •••• 6789';
  const checkoutCta = s.modal === 'pay'
    ? 'Pay ' + money(inv.total)
    : (s.modal === 'seats' ? 'Confirm & charge' : 'Switch plan');
  const confirmCheckout = () => {
    const m = s.modal;
    set({ modal: null });
    if (m === 'pay') flash(inv.number + ' paid · ' + money(inv.total) + ' charged to ' + inv.method);
    else if (m === 'seats') flash(s.addSeats + ' seats added · ' + money(Math.round(seatCost * 0.13)) + ' prorated charge succeeded');
    else flash('Plan switched to ' + s.checkoutPlan + ' · subscription updated in Stripe');
  };

  /* ── text modal ── */
  const confirmModal = () => {
    const m = s.modal;
    set({ modal: null });
    if (m === 'decline') { flash('Signing declined · sender notified and audit trail updated'); set({ screen: 'audit' }); }
    else if (m === 'reassign') flash('Envelope reassigned · original invitation revoked');
    else if (m === 'send') { set({ screen: 'sign' }); flash('Envelope sent · signer view opened'); }
    else flash('Disclosure accepted · consent recorded');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalLabel}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', padding: '24px' }}
    >
      <div style={modalCard}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', padding: '16px 18px', borderBottom: '1px solid #eef1f6' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.2px' }}>{modalTitle}</span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>{modalSub}</span>
          </div>
          <button type="button" aria-label="Close" onClick={closeModal} style={iconBtn}>✕</button>
        </div>

        {isSigModal ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div role="tablist" aria-label="Signature method" style={{ display: 'flex', gap: '4px', background: '#f5f6f8', padding: '4px', borderRadius: '11px' }}>
              {sigTabs.map(t => (
                <button key={t.id} type="button" role="tab" aria-selected={t.selected} onClick={t.onClick} style={t.style}>{t.label}</button>
              ))}
            </div>

            {s.sigTab === 'draw' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                <canvas
                  ref={onCanvasRef}
                  width={1120}
                  height={360}
                  aria-label="Draw your signature"
                  style={{ width: '100%', height: '180px', background: '#fbfcfd', border: '1px dashed #cbd5e1', borderRadius: '12px', touchAction: 'none', cursor: 'crosshair' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11.5px', color: '#64748b' }}>Ink</span>
                    {inks.map(i => (
                      <button key={i.c} type="button" aria-label={i.aria} onClick={i.onClick} style={i.style} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11.5px', color: '#64748b' }}>Stroke</span>
                    <input
                      type="range" min="1" max="9" step="1"
                      value={String(s.sigStroke)}
                      onChange={(e) => set({ sigStroke: parseInt(e.target.value, 10) })}
                      aria-label="Stroke thickness"
                      style={{ width: '120px', accentColor: '#4f46e5' }}
                    />
                    <span style={{ fontSize: '11.5px', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: '#334155' }}>{String(s.sigStroke)}px</span>
                  </div>
                  <button type="button" onClick={clearCanvas} style={ghostBtn}>Clear</button>
                  <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: 'auto' }}>Bézier smoothing · stylus &amp; touch supported</span>
                </div>
              </div>
            ) : null}

            {s.sigTab === 'type' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                <input
                  type="text"
                  value={s.typedName}
                  onChange={(e) => set({ typedName: e.target.value })}
                  aria-label="Typed signature text"
                  style={inputStyle}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
                  {typeFaces.map(f => (
                    <button key={f.name} type="button" onClick={f.onClick} aria-pressed={f.selected} style={f.style}>
                      <span style={f.preview}>{s.typedName}</span>
                      <span style={{ fontSize: '10.5px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{f.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {s.sigTab === 'upload' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                <label style={{ border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '24px', textAlign: 'center', background: '#fbfcfd', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Drop a PNG or JPG of your signature</span>
                  <span style={{ fontSize: '11.5px', color: '#64748b' }}>Background is filtered to transparency automatically</span>
                  <input type="file" accept="image/*" onChange={onUpload} style={{ margin: '9px auto 0', fontSize: '12px' }} />
                </label>
                {s.uploadSrc ? (
                  <div style={{ border: '1px solid #eef1f6', borderRadius: '12px', padding: '12px', display: 'flex', alignItems: 'center', gap: '12px', background: '#fff' }}>
                    <span style={{ display: 'flex' }}>
                      <img src={s.uploadSrc} alt="Uploaded signature preview" style={{ height: '64px', objectFit: 'contain' }} />
                    </span>
                    <span style={{ fontSize: '11.5px', color: '#64748b' }}>Transparency filter applied · 1 layer</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {s.sigTab === 'saved' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {savedSigs.map(sig => (
                  <button key={sig.label} type="button" onClick={sig.onClick} style={sig.style}>
                    <span style={sig.preview}>{sig.name}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', gap: '2px', marginLeft: 'auto' }}>
                      <span style={{ fontSize: '11.5px', color: '#475569', fontWeight: 600 }}>{sig.label}</span>
                      <span style={{ fontSize: '10.5px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{sig.meta}</span>
                    </span>
                  </button>
                ))}
                <div style={{ fontSize: '11.5px', color: '#64748b', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '99px', background: '#10b981' }}></span>
                  Passkey verified on this device — 1-click re-use enabled.
                </div>
              </div>
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid #eef1f6', paddingTop: '13px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5, maxWidth: '420px' }}>
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
              <span style={{ fontSize: '11px', color: '#94a3b8', maxWidth: '280px', lineHeight: 1.5 }}>
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
              <span style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5, maxWidth: '300px' }}>{ntSlaNote}</span>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={lblStyle}>Card number
                  <input type="text" value={s.card.number} onChange={(e) => { const v = e.target.value; set(st => ({ card: Object.assign({}, st.card, { number: v }) })); }} placeholder="4242 4242 4242 4242" inputMode="numeric" style={monoInput} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '9px' }}>
                  <label style={lblStyle}>Expiry
                    <input type="text" value={s.card.exp} onChange={(e) => { const v = e.target.value; set(st => ({ card: Object.assign({}, st.card, { exp: v }) })); }} placeholder="09 / 29" style={monoInput} />
                  </label>
                  <label style={lblStyle}>CVC
                    <input type="text" value={s.card.cvc} onChange={(e) => { const v = e.target.value; set(st => ({ card: Object.assign({}, st.card, { cvc: v }) })); }} placeholder="123" style={monoInput} />
                  </label>
                  <label style={lblStyle}>Postal
                    <input type="text" value={s.card.zip} onChange={(e) => { const v = e.target.value; set(st => ({ card: Object.assign({}, st.card, { zip: v }) })); }} placeholder="94103" style={monoInput} />
                  </label>
                </div>
              </div>
            ) : null}
            {s.payTab === 'ach' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={lblStyle}>Routing number
                  <input type="text" value={s.ach.routing} onChange={(e) => { const v = e.target.value; set(st => ({ ach: Object.assign({}, st.ach, { routing: v }) })); }} placeholder="110000000" style={monoInput} />
                </label>
                <label style={lblStyle}>Account number
                  <input type="text" value={s.ach.account} onChange={(e) => { const v = e.target.value; set(st => ({ ach: Object.assign({}, st.ach, { account: v }) })); }} placeholder="000123456789" style={monoInput} />
                </label>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.55 }}>
                  ACH debit settles in 3–5 business days. Micro-deposit verification is skipped for instant-verified accounts.
                </div>
              </div>
            ) : null}
            {s.payTab === 'invoice' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={lblStyle}>Purchase order number
                  <input type="text" value={s.poNumber} onChange={(e) => set({ poNumber: e.target.value })} placeholder="PO-2026-0142" style={monoInput} />
                </label>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.55 }}>
                  Invoice-based billing is available on Enterprise. Net 30 terms, remittance by wire or ACH credit.
                </div>
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
              <span style={{ fontSize: '10.5px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>
                Tokenised by Stripe · card data never touches SignForge servers
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button type="button" onClick={closeModal} style={ghostBtn}>Cancel</button>
                <button type="button" onClick={savePayment} style={primaryBtn}>{savePaymentLabel}</button>
              </div>
            </div>
          </div>
        ) : null}

        {isCheckoutModal ? (
          <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
            {s.modal === 'plan' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '9px' }}>
                {planChoices.map(p => (
                  <button key={p.name} type="button" onClick={p.onClick} aria-pressed={p.selected} style={p.style}>
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>{p.name}</span>
                    <span style={{ fontSize: '11.5px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{p.price}</span>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                  <span style={{ color: '#64748b' }}>{String(s.addSeats)} seats added</span>
                  <span style={{ fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontWeight: 600 }}>{money(seatCost)}</span>
                </div>
              </div>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid #eef1f6', borderRadius: '12px', padding: '12px', background: '#fbfcfd' }}>
              {checkoutLines.map(l => (
                <div key={l.k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
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
            <div style={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.65, maxHeight: '240px', overflow: 'auto' }}>{modalBody}</div>
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
