'use client';

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useDocumentTitle, useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import type { Recipient, SFField } from '@/lib/sf/state';
import type { SignerField } from '@/lib/sf/adapters';
import { btn, TEXT_MUTED } from '@/lib/sf/ui';
import { drawingOptions, strokePath, textboxFontStack, textboxOptions } from '@/lib/sf/annotations';
import { effectiveValidation, fieldValueProblem, fitsNativeInput, nativeInputType } from '@/lib/sf/fieldValidation';
import LazyPdfPages from '@/components/sf/pdf/LazyPdfPages';
import { useElementWidth } from '@/components/sf/pdf/useElementWidth';
import { typeFaceStack } from '@/lib/sf/fonts';
import type { PaymentFieldConfig, SignerPaymentResponse } from '@/lib/api/types';
import Icon, { type IconName } from '@/components/sf/Icon';

export type SignerProps = {
  /**
   * The fields assigned to the signer. Omitted on the sender's preview, which
   * falls back to the store's authoring fields so the builder and the preview
   * always agree.
   */
  fields?: SignerField[] | SFField[];
  /** Recipients of the envelope, for field-tag colours. */
  recipients?: Recipient[];
  /** `page_count` of the document, so empty pages still render as paper. */
  pageCount?: number;
  /** The envelope's name, for the sidebar's contextual group. */
  title?: string;
  /** A completed / read-only session shows values but accepts no edits. */
  readOnly?: boolean;
  /**
   * Values already stored on the server, seeded once into the signer's draft
   * buffer (`state.signValues`) so a returning signer sees their own work. Only
   * the draft buffer is seeded — nothing else server-side enters the store.
   */
  initialValues?: Record<string, unknown>;
  /** Persist a value (text, checkbox, dropdown). The store is updated first. */
  onSaveValue?: (field: SFField, value: string | boolean) => void;
  /** Open the signature ceremony for a signature/initials field. */
  onOpenSignature?: (fieldId: string) => void;
  onDisclosure?: () => void;
  onDecline?: () => void;
  onReassign?: () => void;
  onFinish?: () => void;
  onDownload?: () => void;
  /**
   * A same-origin URL that streams the document being signed
   * (`/sign/{token}/pdf`, or the session proxy on the sender's preview).
   *
   * Until this existed the surface painted "MASTER SERVICES AGREEMENT —
   * SIGNATURE PAGE" on every page of every envelope (audit C2): the signer was
   * asked to attest to paper they had never been shown, which is precisely what
   * the ESIGN consent captured one screen earlier claims they did see.
   */
  pdfUrl?: string | null;
  /**
   * Other recipients' placements, redacted to geometry by the API
   * (`other_field_placements`). Drawn as inert grey regions so this signer can
   * see which parts of the page are already spoken for — the reason the
   * backend keeps returning them after it stopped returning the fields
   * themselves.
   */
  otherPlacements?: OtherPlacement[];
  /**
   * The sender's own marks on the page — a pen drawing or a text box (ANN-1).
   * They are content, not an obligation: every recipient sees them whoever they
   * were assigned to, they are inert, and they are burned into the completed
   * PDF exactly as drawn here.
   */
  annotations?: PageAnnotation[];
  /** Upload a file into an `attachment` or `stamp` field. */
  onUploadAttachment?: (field: SFField, file: File) => void;
  /**
   * URL that streams back a file this signer already uploaded, by field id
   * (`GET /sign/{token}/fields/{id}/attachment`). Omitted on the sender's
   * preview, where nothing has been uploaded.
   */
  stampEndpoint?: (fieldId: string) => string;
  /**
   * A CC / `copy` recipient gets the document and the audit trail, not a
   * signing ceremony. Renders the honest read-only view instead of a progress
   * bar and a Finish button that would do nothing.
   */
  viewOnly?: boolean;
  /**
   * Open the payment ceremony for a `payment` field (PAY-1). Omitted on the
   * sender's preview, where the Pay button renders disabled rather than
   * inert — the preview must never be able to trigger a real charge.
   */
  onPay?: (fieldId: string) => void;
  /** Each payment field's own configuration (amount, currency, memo…),
   *  keyed by field id — `SignerField.options` does not carry it (see
   *  `getPaymentFieldConfig`), so the caller fetches and supplies it. */
  paymentConfigs?: Record<string, PaymentFieldConfig | null | undefined>;
  /** The latest known `SignerPayment` per payment field, keyed by field id. */
  paymentStatuses?: Record<string, SignerPaymentResponse | null | undefined>;
};

/** `backend/app/schemas/signer.py:AnnotationResponse`. Geometry in points. */
export type PageAnnotation = {
  id: string;
  type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  default_value?: string | null;
  options?: Record<string, unknown> | unknown[] | null;
};

/** `FieldPlacementResponse` — geometry only, by design. */
export type OtherPlacement = {
  id: string;
  type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Which fields the signer actually sees: the prototype's `signable()`, but over
 * whatever field list this instance was given (props on the public signing
 * route, the store on the sender's in-app preview).
 */
/** Cents → a locale money string, falling back to a plain number if the
 *  currency code is somehow not one `Intl` recognises. */
function formatPayCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${(currency || 'usd').toUpperCase()}`;
  }
}

function signableOf(fields: (SignerField | SFField)[], values: Record<string, unknown>) {
  return fields.filter(f => {
    if (f.readOnly) return false;
    if (f.cond) {
      const v = values[f.cond.field];
      if (f.cond.op === 'checked' && v !== true) return false;
      if (f.cond.op === 'equals' && String(v || '') !== f.cond.value) return false;
      if (f.cond.op === 'notEmpty' && !v) return false;
    }
    return true;
  });
}

export default function Signer({
  fields, recipients, pageCount, title, readOnly = false, initialValues,
  onSaveValue, onOpenSignature, onDisclosure, onDecline, onReassign, onFinish, onDownload,
  pdfUrl, otherPlacements, annotations, onUploadAttachment, stampEndpoint, viewOnly = false,
  onPay, paymentConfigs, paymentStatuses,
}: SignerProps = {}) {
  const { s, set, flash, accent, recip, meta, signable, isDone } = useSF();
  const { go } = useNav();
  const A = accent();
  useDocumentTitle(title);

  /* Object URLs for stamps picked in this session, so the seal appears the
     instant it is chosen rather than after a round trip. Revoked on unmount. */
  const [stampUrls, setStampUrls] = useState<Record<string, string>>({});
  const setStampUrl = (fieldId: string, url: string) => setStampUrls(prev => {
    if (prev[fieldId]) URL.revokeObjectURL(prev[fieldId]);
    return Object.assign({}, prev, { [fieldId]: url });
  });
  useEffect(() => () => { Object.values(stampUrlsRef.current).forEach(url => URL.revokeObjectURL(url)); }, []);
  const stampUrlsRef = useRef<Record<string, string>>({});
  stampUrlsRef.current = stampUrls;

  const signEls = useRef<Record<string, HTMLDivElement | null>>({});
  const signScroll = useRef<HTMLDivElement | null>(null);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !initialValues || !Object.keys(initialValues).length) return;
    seeded.current = true;
    set(st => ({ signValues: Object.assign({}, initialValues, st.signValues) }));
  }, [initialValues, set]);

  // The sender's preview keeps the prototype's single page-1 sheet; a real
  // session renders one sheet per page so nothing assigned is unreachable.
  const signList = fields
    ? signableOf(fields, s.signValues)
    : signable().filter(f => f.page === 1);
  const pages = fields
    ? Array.from(new Set([
      ...Array.from({ length: Math.max(1, pageCount ?? 1) }, (_, i) => i + 1),
      ...signList.map(f => f.page || 1),
    ])).sort((a, b) => a - b)
    : [1];

  const resolveRecip = (id: string): Recipient => {
    if (recipients && recipients.length) return recipients.find(r => r.id === id) ?? recipients[0];
    return recip(id);
  };

  /* A value the API will reject is not a completed field, however full it
     looks: counting it would let the signer reach 100% and press Finish only
     to be stopped by a 400 they were never warned about. */
  const problemFor = (f: SignerField | SFField) => fieldValueProblem(f, s.signValues[f.id]);
  /**
   * A settled payment completes its field.
   *
   * `isDone` can only see `signValues`, and a payment is never typed into
   * there: the *backend* marks the field paid (`field.value = "paid:<intent>"`
   * in `signer_payment_service._reconcile`). That value does arrive on the
   * next read, but `initialValues` is seeded once per mount (see `seeded`
   * above), so the refresh that follows settlement never merges it in — the
   * field showed "Paid $500.00" while the counter still called it outstanding
   * and "Next required field" kept pointing at money already taken.
   *
   * Checked against the live status as well as the seeded `paid:` value so
   * neither path alone has to win: the status covers a payment settled in this
   * session, the value covers a reload where the status fetch has not landed.
   */
  const paymentSettled = (f: SignerField | SFField) =>
    f.type === 'payment' && (
      paymentStatuses?.[f.id]?.status === 'succeeded'
      || String(s.signValues[f.id] ?? '').startsWith('paid:')
    );
  const complete = (f: SignerField | SFField) => paymentSettled(f) || (isDone(f) && !problemFor(f));
  const req = signList.filter(f => f.required);
  const done = req.filter(f => complete(f)).length;
  const pct = req.length ? Math.round((done / req.length) * 100) : 100;

  /**
   * Reading order down the document: page, then top edge, then left edge. The
   * "next" field has to be the next one the signer's eye reaches, not the next
   * one in whatever order the sender happened to place them.
   */
  const inReadingOrder = (a: SignerField | SFField, b: SignerField | SFField) =>
    (a.page || 1) - (b.page || 1) || a.y - b.y || a.x - b.x;
  const pending = signList.filter(f => f.required && !complete(f)).sort(inReadingOrder);
  /* What the guide points at: the field the signer is on if it is still
     outstanding, otherwise the next one down the page. */
  const target = pending.find(f => f.id === s.activeSignField) ?? pending[0] ?? null;

  /**
   * Put a field on screen.
   *
   * Measured against the scroll box, not `offsetTop`: a field is absolutely
   * positioned inside its own page box, so its `offsetTop` is its offset within
   * that page. Scrolling by it landed every field on page 2+ hundreds of pixels
   * short — the signer pressed "Next required field" and the document barely
   * moved.
   */
  const scrollToField = (id: string, opts?: { instant?: boolean }) => {
    const el = signEls.current[id];
    const box = signScroll.current;
    if (!el || !box) return;
    const e = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    // Centred where there is room, but never above the sticky header's shadow.
    const inset = Math.max(96, (box.clientHeight - e.height) / 2);
    const top = box.scrollTop + (e.top - b.top) - inset;
    /* Smooth is right when the signer asked to be moved — it shows them the
       document going past. It is wrong for the landing on open: that jump can
       be 25 pages long, and animating it means several seconds of scenery
       before they can act. Place them, don't take them on a tour. */
    const smooth = !opts?.instant
      && typeof window !== 'undefined'
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof box.scrollTo === 'function') box.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    else box.scrollTop = Math.max(0, top);
    // Keyboard and screen-reader users are taken to the field, not just shown it.
    const control = el.querySelector<HTMLElement>('button, input, select, textarea');
    if (control) control.focus({ preventScroll: true });
  };

  const goToField = (f: SignerField | SFField) => {
    set({ activeSignField: f.id });
    scrollToField(f.id);
    if (f.type === 'signature' || f.type === 'initials') {
      if (onOpenSignature) onOpenSignature(f.id);
      else set({ modal: 'signature' });
    }
  };

  const nextField = () => {
    if (!target) { flash('All required fields complete — ready to finish'); return; }
    goToField(target);
  };

  const openSig = (id: string) => {
    if (readOnly) { flash('This envelope is complete · no further edits'); return; }
    if (onOpenSignature) { set({ activeSignField: id }); onOpenSignature(id); return; }
    set({ modal: 'signature', activeSignField: id, sigTab: 'draw' });
  };

  const finish = () => {
    // An optional field with a bad value would silently never be saved, so it
    // is a blocker too — not just the required ones the progress bar counts.
    const broken = signList.find(f => problemFor(f));
    if (broken) {
      flash(broken.label + ' · ' + problemFor(broken));
      set({ activeSignField: broken.id });
      scrollToField(broken.id);
      return;
    }
    if (pct < 100) { flash('Complete all required fields first'); nextField(); return; }
    if (onFinish) { onFinish(); return; }
    // Only reached in the sender's preview at `/documents/<id>/signer-view`
    // (the real signing session always supplies `onFinish`), so `go` carries
    // that route's document into the audit trail.
    go('audit'); flash('Envelope completed · certificate sealed');
  };

  const primaryBtn = btn(A, '#fff', A);
  /* Finish is the sender's colour like every other primary action here: a
     stock green beside a branded "Start signing" read as two products. */
  const successBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const signPctStyle: CSSProperties = { fontSize: '.71875rem', fontWeight: 700, fontFamily: 'var(--font-sans)', color: pct === 100 ? '#047857' : A };
  const signBarStyle: CSSProperties = { width: pct + '%', height: '100%', borderRadius: '99px', background: pct === 100 ? '#10b981' : A, transition: 'width .25s ease' };
  const nextFieldLabel = done === 0 ? 'Start signing' : (pct === 100 ? 'All fields complete' : 'Next required field');
  /**
   * One field, laid out on a page drawn at `scale` CSS pixels per PDF point.
   *
   * Field geometry is points with a top-left origin (see `lib/sf/adapters.ts`),
   * which is why this is a plain multiply and not a conversion: the sheet used
   * to be a fixed 816 × 1056 box with the point values pasted straight in as
   * pixels, so every field sat in the wrong place on any page that was not
   * US Letter — and the whole surface panned sideways on a phone.
   */
  const fieldView = (f: SignerField | SFField, scale: number) => {
    const r = resolveRecip(f.to), t = meta(f.type);
    const v = s.signValues[f.id];
    const isSig = f.type === 'signature' || f.type === 'initials';
    const typed = typeof v === 'string' && v.indexOf('typed:') === 0 ? v.split(':') : null;
    const active = s.activeSignField === f.id;
    /* The field the guide is pointing at, so "next" is visible on the page and
       not only in the header. */
    const isNext = target ? target.id === f.id : false;
    /* A paid payment field earns the same green "done" border as any other
       completed field — see `paymentSettled`. */
    const filled = isDone(f) || paymentSettled(f);
    const options = (f as SignerField).options ?? [];
    const radio = (f as SignerField).radio ?? null;
    const problem = fieldValueProblem(f, v);
    const kind = effectiveValidation(f);
    return {
      id: f.id,
      page: f.page || 1,
      box: {
        position: 'absolute', left: (f.x * scale) + 'px', top: (f.y * scale) + 'px', width: (f.w * scale) + 'px', height: (f.h * scale) + 'px',
        border: '1.5px solid ' + (problem ? '#dc2626' : (filled ? '#10b981' : r.color)), borderRadius: '6px',
        background: problem ? '#fef2f2' : (filled ? '#ecfdf5' : r.color + '14'),
        boxShadow: active ? '0 0 0 4px ' + r.color + '40' : (isNext ? '0 0 0 3px ' + r.color + '2e' : 'none'),
        display: 'flex', alignItems: 'center', padding: '2px'
      } as CSSProperties,
      tag: {
        position: 'absolute', top: '-9px', left: '-1px', height: '17px', padding: '0 6px', borderRadius: '5px',
        background: problem ? '#dc2626' : (filled ? '#10b981' : r.color), color: '#fff', fontSize: '.59375rem', fontWeight: 700, display: 'flex', alignItems: 'center', fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap'
      } as CSSProperties,
      /* The tag's state mark is an SVG, not a glyph: '✓'/'➜' rendered at
         whatever weight the fallback font supplied, and at 9.5px that read as
         noise beside the label. `data-mark` keeps the state assertable. */
      tagMark: (problem ? 'alert' : (filled ? 'check' : (isNext ? 'arrowRight' : (f.required ? 'asterisk' : null)))) as IconName | null,
      tagText: t.label,
      aria: t.label + ' — ' + f.label + (f.required ? ' (required)' : '') + (isNext ? ' — next' : ''),
      isSig, isCheck: f.type === 'checkbox',
      /* The field the signer owes next, called out on the page itself. The
         header line and the corner guide both name it, but neither helps
         someone already looking straight at the document. */
      isNext: isNext && !filled && !problem,
      nextHint: (done === 0 ? 'Start here — ' : 'Next — ') + (isSig ? 'click to sign' : 'click to complete'),
      nextStyle: {
        position: 'absolute', left: '50%', top: '100%', transform: 'translateX(-50%)', marginTop: '7px',
        display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', pointerEvents: 'none',
        height: '22px', padding: '0 9px', borderRadius: '99px', background: A, color: '#fff',
        fontSize: '.65625rem', fontWeight: 700, fontFamily: 'var(--font-sans)',
        boxShadow: '0 8px 18px -10px rgba(15,23,42,.7)',
      } as CSSProperties,
      /* A Radio Group is a set of radio buttons, not a dropdown. Both used to
         render the same `<select>`, so a field the sender placed as a radio
         group asked the signer to "Select…" from a menu. */
      isSelect: f.type === 'dropdown',
      /** A radio field authored before groups existed: one box, every choice. */
      isRadio: f.type === 'radio' && !radio,
      /**
       * One button of a radio group, drawn where the sender put it. The group's
       * answer is a single value every member of the group carries, so picking
       * this button writes its choice to all of them — which is what makes the
       * choice exclusive, and what lets each button's own `required` be met.
       */
      radio,
      radioChecked: radio ? v === radio.choice : false,
      radioName: radio ? 'radio-' + radio.group : f.id,
      radioLabel: radio ? radio.groupLabel + ' — ' + radio.choice : '',
      radioAria: radio
        ? radio.groupLabel + ': ' + radio.choice + ' (' + (radio.choices.indexOf(radio.choice) + 1)
          + ' of ' + radio.choices.length + ')' + (f.required ? ' — required' : '')
        : '',
      radioBtn: {
        width: '100%', height: '100%', margin: 0, cursor: readOnly ? 'default' : 'pointer',
        accentColor: r.color,
      } as CSSProperties,
      /** Pick this button — for the whole group. */
      onPickButton: () => {
        if (readOnly) { flash('This envelope is complete · no further edits'); return; }
        if (!radio) return;
        const members = signList.filter(item => {
          const other = (item as SignerField).radio;
          return other ? other.group === radio.group : false;
        });
        set(st => {
          const next = Object.assign({}, st.signValues);
          for (const member of members) next[member.id] = radio.choice;
          return { signValues: next };
        });
        if (onSaveValue) for (const member of members) onSaveValue(member, radio.choice);
      },
      isAttachment: f.type === 'attachment',
      /* A stamp is a mark on the page — a seal, a chop, a logo — so it is an
         image upload, and the executed PDF draws the image. It used to render
         as a plain text box, which meant the signer typed a word where a seal
         belonged. */
      isStamp: f.type === 'stamp',
      isText: !isSig && f.type !== 'checkbox' && f.type !== 'dropdown' && f.type !== 'radio'
        && f.type !== 'attachment' && f.type !== 'stamp' && f.type !== 'payment',
      /** Images only; a PDF cannot be drawn into the stamp's box. */
      fileAccept: f.type === 'stamp' ? 'image/png,image/jpeg,image/gif,image/webp' : undefined,
      /**
       * A money obligation on the page (PAY-1). The field's own config
       * (amount, currency, memo) is fetched separately and handed in by the
       * caller — see `SignerProps.paymentConfigs` — because `SignerField`
       * only carries dropdown/radio-shaped options.
       */
      isPayment: f.type === 'payment',
      payConfig: (paymentConfigs?.[f.id] ?? null) as PaymentFieldConfig | null,
      payStatus: (paymentStatuses?.[f.id] ?? null) as SignerPaymentResponse | null,
      onPayClick: () => {
        if (readOnly) { flash('This envelope is complete · no further edits'); return; }
        if (!onPay) { flash('Preview only · no real charge is made from here'); return; }
        /* Marked active the way `openSig` does for a signature: the
           auto-advance effect carries the signer on *from* the active field,
           so without this a settled payment leaves the guide with no anchor
           and the document never moves down to the next required field. */
        set({ activeSignField: f.id });
        onPay(f.id);
      },
      required: f.required ? true : false,
      /** Why the typed value is not acceptable yet, or null. */
      problem,
      /* A date field opens the browser's calendar and a datetime field its
         date-and-time picker, which is also what makes them self-validating:
         the control cannot emit a malformed value. A value stored in some
         other shape by an earlier session stays editable as plain text. */
      inputType: fitsNativeInput(f, v) ? nativeInputType(f) : 'text',
      inputMode: (kind === 'numeric' ? 'decimal' : (kind === 'email' ? 'email' : undefined)) as
        React.HTMLAttributes<HTMLInputElement>['inputMode'],
      value: v && !typed ? String(v) : '',
      placeholder: f.placeholder || f.label,
      cta: f.type === 'initials' ? 'Initial' : 'Sign here',
      empty: !v,
      hasImage: !!(v && String(v).indexOf('data:') === 0),
      imgWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' } as CSSProperties,
      imgSrc: v && String(v).indexOf('data:') === 0 ? String(v) : null,
      imgStyle: { maxHeight: Math.max(8, f.h * scale - 12) + 'px', maxWidth: '100%', objectFit: 'contain' } as CSSProperties,
      hasTyped: !!typed,
      typedText: typed ? typed.slice(2).join(':') : '',
      typedStyle: { fontFamily: typeFaceStack(typed ? typed[1] : null), fontSize: Math.max(10, Math.min(30, f.h * scale - 18)) + 'px', color: '#0f172a', lineHeight: 1 } as CSSProperties,
      sigBtn: { width: '100%', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' } as CSSProperties,
      onSign: () => openSig(f.id),
      /** Real dropdown choices when the field was authored with them. */
      options,
      checked: v === true,
      checkStyle: { width: '100%', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1rem', color: '#047857', fontWeight: 700 } as CSSProperties,
      onCheck: () => {
        if (readOnly) { flash('This envelope is complete · no further edits'); return; }
        const next = s.signValues[f.id] === true ? false : true;
        set(st => ({ signValues: Object.assign({}, st.signValues, { [f.id]: next }) }));
        if (onSaveValue) onSaveValue(f, next);
      },
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const val = e.target.value;
        set(st => ({ signValues: Object.assign({}, st.signValues, { [f.id]: val }) }));
      },
      /** A radio has no blur to commit on — picking one *is* the answer. */
      onPick: (choice: string) => {
        if (readOnly) { flash('This envelope is complete · no further edits'); return; }
        set(st => ({ signValues: Object.assign({}, st.signValues, { [f.id]: choice }) }));
        if (onSaveValue) onSaveValue(f, choice);
      },
      /** Radio buttons stack when the box is tall enough for them to fit. */
      radioWrap: {
        display: 'flex', flexDirection: (f.h * scale) >= 26 * Math.max(2, options.length) ? 'column' : 'row',
        flexWrap: 'wrap', gap: '2px 10px', width: '100%', height: '100%',
        padding: '2px 7px', overflow: 'auto', alignContent: 'center',
      } as CSSProperties,
      radioRow: {
        display: 'flex', alignItems: 'center', gap: '5px', fontSize: '.71875rem',
        color: '#0f172a', cursor: readOnly ? 'default' : 'pointer', whiteSpace: 'nowrap',
      } as CSSProperties,
      /** A picker commits on change — there is no "half-typed" date. */
      onPickerChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        set(st => ({ signValues: Object.assign({}, st.signValues, { [f.id]: val }) }));
        if (!val) return;
        if (readOnly) return;
        if (onSaveValue) onSaveValue(f, val);
      },
      isPicker: f.type === 'date' || f.type === 'datetime',
      onCommit: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
        // Don't post what the API will refuse; the field stays flagged and
        // uncounted until it is fixed, and the reason is on screen.
        const wrong = fieldValueProblem(f, e.target.value);
        if (wrong) { flash(f.label + ' · ' + wrong); return; }
        if (onSaveValue) onSaveValue(f, e.target.value);
      },
      /** Where a stamp already uploaded is read back from, so a reload shows it. */
      stampSrc: stampUrls[f.id] ?? (isDone(f) && stampEndpoint ? stampEndpoint(f.id) : null),
      /** Real upload for an `attachment` or `stamp` field. */
      onFile: (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (f.type === 'stamp' && !file.type.startsWith('image/')) {
          flash('A stamp has to be an image — PNG, JPEG, GIF or WebP');
          e.target.value = '';
          return;
        }
        // Two different situations, and they used to share one misleading
        // message: a completed envelope really is closed, but the sender's
        // preview simply has no upload handler — nothing is wrong with it.
        if (readOnly) { flash('This envelope is complete · no further edits'); return; }
        if (!onUploadAttachment) { flash('Preview only · ' + file.name + ' is not uploaded from here'); return; }
        set(st => ({ signValues: Object.assign({}, st.signValues, { [f.id]: file.name }) }));
        // Shown immediately from the local file; the server copy takes over on
        // the next load.
        if (f.type === 'stamp') setStampUrl(f.id, URL.createObjectURL(file));
        onUploadAttachment(f, file);
      },
      inputStyle: { width: '100%', height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '.78125rem', padding: '0 7px', color: '#0f172a' } as CSSProperties
    };
  };

  const fieldsOnPage = (page: number, scale: number) =>
    signList.filter(f => (f.page || 1) === page).map(f => fieldView(f, scale));

  const runOr = (handler: (() => void) | undefined, modal: string) => () => {
    if (handler) handler(); else set({ modal });
  };

  /* The page is fitted to the space the surface actually has, so a 390 px
     phone gets a whole page instead of a horizontally-panning 816 px sheet.
     `maxWidth` keeps a page from becoming absurd on a wide monitor. */
  const [scrollRef, viewportWidth] = useElementWidth<HTMLDivElement>();
  const attachScroll = (node: HTMLDivElement | null) => { signScroll.current = node; scrollRef(node); };
  const availableWidth = Math.max(240, (viewportWidth || 816) - 28);

  /**
   * Where the next field lies relative to what the signer can see — above,
   * below, or on screen right now — and which page they are actually reading,
   * so the guide can say "next page" rather than show a bare arrow.
   *
   * It stays up for the whole ceremony rather than only while the field is off
   * screen: a signer who cannot find where to sign is not helped by a pointer
   * that hides itself the moment the field scrolls into view somewhere.
   */
  const [guideDir, setGuideDir] = useState<'up' | 'down' | 'here'>('here');
  const [viewPage, setViewPage] = useState(1);
  const targetId = target ? target.id : null;
  useEffect(() => {
    const box = signScroll.current;
    if (!box || !targetId) { setGuideDir('here'); return; }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const r = box.getBoundingClientRect();
      /* Clamped to the window: when the whole document area is taller than the
         viewport the *page* scrolls, so the box's own rect runs far below the
         fold and every field measures as "in view". */
      const vh = typeof window === 'undefined' ? r.bottom : window.innerHeight;
      const b = { top: Math.max(r.top, 0), bottom: Math.min(r.bottom, vh) };
      /* The page covering most of the viewport is the one being read. */
      let best = 0, bestPage = 0;
      box.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((node) => {
        const r = node.getBoundingClientRect();
        const overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        if (overlap > best) { best = overlap; bestPage = Number(node.dataset.pdfPage) || 1; }
      });
      if (bestPage) setViewPage(bestPage);
      const el = signEls.current[targetId];
      if (!el) { setGuideDir('down'); return; }
      const e = el.getBoundingClientRect();
      if (e.bottom < b.top + 8) setGuideDir('up');
      else if (e.top > b.bottom - 8) setGuideDir('down');
      else setGuideDir('here');
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    box.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // The pages settle in after pdf.js measures them, which moves every field.
    const settle = window.setTimeout(measure, 400);
    return () => {
      box.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.clearTimeout(settle);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [targetId, availableWidth, pages.length]);

  /**
   * Open the envelope *on* the first outstanding field rather than at the top
   * of page 1.
   *
   * These documents run to 25 pages with one signature apiece, so a signer
   * returning to a part-finished envelope landed on page 1 and had to press
   * "Next required field" before anything moved — the guide named a field 12
   * pages away and left them to find it. `pending[0]` is already sorted by
   * `inReadingOrder`, so this lands on the topmost thing still owed.
   *
   * Deliberately not instant: pdf.js sizes the pages only after it parses the
   * file, and every field moves when it does (the same reason the guide's
   * `measure` re-runs on a settle timer above). Scrolling before then measures
   * against a collapsed layout and lands nowhere near the field, so this waits
   * for a laid-out target and a scrollable box, then goes once.
   *
   * It also yields to the signer: any scroll, key or pointer input before the
   * land cancels it outright. Arriving to find the page yanked out from under
   * you is worse than arriving at the top.
   */
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || readOnly || !targetId) return;
    const box = signScroll.current;
    if (!box) return;

    const cancel = () => { landed.current = true; };
    const opts = { passive: true, once: true } as const;
    box.addEventListener('wheel', cancel, opts);
    box.addEventListener('touchstart', cancel, opts);
    window.addEventListener('keydown', cancel, opts);
    box.addEventListener('pointerdown', cancel, opts);

    let timer = 0;
    let tries = 0;
    const tryLand = () => {
      if (landed.current) return;
      const el = signEls.current[targetId];
      const laidOut = el && el.getBoundingClientRect().height > 0;
      const scrollable = box.scrollHeight > box.clientHeight;
      if (laidOut && scrollable) { landed.current = true; scrollToField(targetId, { instant: true }); return; }
      // ~6s, then give up: a late yank is worse than none at all.
      if (++tries > 60) { landed.current = true; return; }
      timer = window.setTimeout(tryLand, 100);
    };
    timer = window.setTimeout(tryLand, 100);

    return () => {
      window.clearTimeout(timer);
      box.removeEventListener('wheel', cancel);
      box.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', cancel);
      box.removeEventListener('pointerdown', cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, readOnly]);

  const guideLabel = target
    ? target.label + ' · page ' + String(target.page || 1)
    : null;

  /* What the guide says. "Next page" only when the field really is on another
     sheet — otherwise the arrow is about scrolling, not paging. */
  const targetPage = target ? (target.page || 1) : 1;
  const guideIcon: IconName =
    guideDir === 'up' ? 'arrowUp' : (guideDir === 'here' ? 'arrowRight' : 'arrowDown');
  const guideText = !target ? null
    : guideDir === 'here'
      ? (target.type === 'signature' || target.type === 'initials' ? 'Sign here · ' : 'Complete · ') + target.label
      : guideDir === 'up'
        ? 'Back to ' + guideLabel
        : (targetPage > viewPage ? 'Next page · ' : 'Next: ') + guideLabel;

  /**
   * After a signature, initials, or a payment is applied, carry the signer on
   * to the next outstanding field — always `pending[0]`, which is sorted by
   * `inReadingOrder`, so the guide walks the document top to bottom and comes
   * to rest on the next signature or required field rather than wherever the
   * signer last happened to click.
   *
   * Only these three: each completes in one deliberate gesture that closes its
   * own modal, so there is no half-finished state to yank the page away from —
   * a text field, which commits on blur, would move the document out from
   * under someone still reading what they typed.
   *
   * A payment is keyed separately in the deps because it does not land in
   * `signValues` at all (see `paymentSettled`): settlement arrives as a
   * `paymentStatuses` prop, so without `settledPayments` this effect would
   * never re-run when the charge went through and the guide would stall on the
   * field it had just paid.
   */
  const settledPayments = signList.filter(f => f.type === 'payment' && paymentSettled(f)).map(f => f.id).join(',');
  const advancedFrom = useRef<string | null>(null);
  useEffect(() => {
    const active = s.activeSignField;
    if (!active || advancedFrom.current === active) return;
    const f = signList.find(x => x.id === active);
    const oneGesture = f && (f.type === 'signature' || f.type === 'initials' || f.type === 'payment');
    if (!f || !oneGesture || !complete(f)) return;
    advancedFrom.current = active;
    const next = pending[0];
    if (!next || next.id === active) return;
    set({ activeSignField: next.id });
    scrollToField(next.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.activeSignField, s.signValues, settledPayments]);

  /* One of the sender's marks, drawn at the same scale as everything else on
     the page. Inert in every sense: `pointerEvents: none` and `aria-hidden`
     where it has no text, so it never intercepts a signer's tap on a field
     underneath it. */
  const annotationNode = (a: PageAnnotation, scale: number) => {
    const w = a.width * scale, h = a.height * scale;
    const box: CSSProperties = {
      position: 'absolute', left: (a.x * scale) + 'px', top: (a.y * scale) + 'px',
      width: w + 'px', height: h + 'px', pointerEvents: 'none', overflow: 'hidden',
    };
    if (a.type === 'drawing') {
      const ink = drawingOptions(a.options ?? null);
      if (!ink.strokes.length) return null;
      return (
        <svg key={a.id} data-sf-ink="1" aria-hidden="true" viewBox={'0 0 ' + Math.max(1, w) + ' ' + Math.max(1, h)}
          style={Object.assign({}, box, { overflow: 'visible' })}>
          {ink.strokes.map((stroke, i) => (
            <path key={i} d={strokePath(stroke, w, h)} fill="none" stroke={ink.color}
              strokeWidth={Math.max(0.5, ink.stroke * scale)} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      );
    }
    const text = a.default_value ?? '';
    if (!text) return null;
    const style = textboxOptions(a.options ?? null);
    return (
      <div key={a.id} style={Object.assign({}, box, {
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '2px 3px',
        fontFamily: textboxFontStack(style.font), fontSize: (style.size * scale) + 'px', lineHeight: 1.2,
        fontWeight: style.bold ? 700 : 400, fontStyle: style.italic ? 'italic' : 'normal', color: style.color,
      } as CSSProperties)}>{text}</div>
    );
  };

  const fieldNodes = (page: number, scale: number) => (
    <>
      {(annotations ?? []).filter(a => (a.page_number || 1) === page).map(a => annotationNode(a, scale))}
      {(otherPlacements ?? [])
        .filter(p => (p.page_number || 1) === page)
        .map(p => (
          <div
            key={p.id}
            aria-hidden="true"
            title="Another recipient completes this area"
            style={{
              position: 'absolute', left: (p.x * scale) + 'px', top: (p.y * scale) + 'px',
              width: (p.width * scale) + 'px', height: (p.height * scale) + 'px',
              border: '1px dashed #8492a6', borderRadius: '6px', background: 'rgba(148,163,184,.12)',
              pointerEvents: 'none',
            }}
          ></div>
        ))}
      {fieldsOnPage(page, scale).map(f => (
        <div key={f.id} data-sf-field={f.id} ref={(el) => { if (el) signEls.current[f.id] = el; else delete signEls.current[f.id]; }} style={f.box}>
          <span style={f.tag} data-mark={f.tagMark ?? ''}>{f.tagMark ? <Icon name={f.tagMark} size={9} style={{ marginRight:'3px' }} /> : null}{f.tagText}</span>
          {f.isSig ? (
            <button type="button" onClick={f.onSign} aria-label={f.aria} style={f.sigBtn}>
              {f.hasImage ? (
                <span style={f.imgWrap}>
                  {f.imgSrc ? <img src={f.imgSrc} alt="Applied signature" style={f.imgStyle} /> : null}
                </span>
              ) : null}
              {f.hasTyped ? (<span style={f.typedStyle}>{f.typedText}</span>) : null}
              {f.empty ? (<span style={{ fontSize: '.75rem', fontWeight: 600, color: '#475569' }}>{f.cta}</span>) : null}
            </button>
          ) : null}
          {f.isCheck ? (
            <button type="button" role="checkbox" aria-checked={f.checked} aria-label={f.aria} onClick={f.onCheck} style={f.checkStyle}>{f.checked ? <Icon name="check" size={14} /> : null}</button>
          ) : null}
          {f.isSelect ? (
            /* The choices are the ones the sender authored, and only those.
               This used to fall back to an invented "Net 30 / Net 45 / Net 60"
               list; the API now enforces the authored option set server-side,
               so an invented option is a 400 the signer cannot get past. With
               no options authored there is nothing honest to offer, so the
               control says so and stays disabled. */
            f.options.length ? (
              <select value={f.value} onChange={f.onChange} onBlur={f.onCommit} disabled={readOnly} aria-label={f.aria} aria-required={f.required} style={f.inputStyle}>
                <option value="">Select…</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <span role="note" style={{ fontSize: '.6875rem', color: '#b45309', padding: '0 7px', lineHeight: 1.3 }}>
                No choices were set for this field — ask the sender to add them.
              </span>
            )
          ) : null}
          {f.radio ? (
            /* The button *is* the field: no label beside it, because the words
               it answers are printed on the page the sender placed it on. */
            <input
              type="radio"
              name={f.radioName}
              value={f.radio.choice}
              checked={f.radioChecked}
              onChange={f.onPickButton}
              disabled={readOnly}
              required={f.required}
              aria-label={f.radioAria}
              style={f.radioBtn}
            />
          ) : null}
          {f.isRadio ? (
            f.options.length ? (
              <div role="radiogroup" aria-label={f.aria} aria-required={f.required} style={f.radioWrap}>
                {f.options.map(o => (
                  <label key={o} style={f.radioRow}>
                    <input
                      type="radio"
                      name={f.id}
                      value={o}
                      checked={f.value === o}
                      onChange={() => f.onPick(o)}
                      disabled={readOnly}
                    />
                    <span>{o}</span>
                  </label>
                ))}
              </div>
            ) : (
              <span role="note" style={{ fontSize: '.6875rem', color: '#b45309', padding: '0 7px', lineHeight: 1.3 }}>
                No choices were set for this field — ask the sender to add them.
              </span>
            )
          ) : null}
          {f.isStamp ? (
            <label style={{ position:'relative', display:'flex', alignItems:'center', justifyContent:'center', gap:'6px', width:'100%', height:'100%', padding:'2px', cursor: readOnly ? 'default' : 'pointer', overflow:'hidden' }}>
              {f.stampSrc ? (
                <img src={f.stampSrc} alt={'Stamp for ' + f.aria} style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
              ) : (
                <span style={{ fontSize:'.6875rem', fontWeight:600, color:'#475569', textAlign:'center', lineHeight:1.3 }}>
                  Upload stamp image
                </span>
              )}
              <input
                type="file"
                accept={f.fileAccept}
                onChange={f.onFile}
                disabled={readOnly}
                aria-label={f.aria}
                aria-required={f.required}
                style={{ position:'absolute', width:'1px', height:'1px', opacity:0, overflow:'hidden' }}
              />
            </label>
          ) : null}
          {f.isAttachment ? (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100%', height: '100%', padding: '0 7px', cursor: readOnly ? 'default' : 'pointer', fontSize: '.71875rem', color: '#334155', overflow: 'hidden' }}>
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap', display:'inline-flex', alignItems:'center', gap:'4px' }}>{f.value ? <><Icon name="check" size={11} />{f.value}</> : 'Choose file'}</span>
              <input
                type="file"
                onChange={f.onFile}
                disabled={readOnly}
                aria-label={f.aria}
                aria-required={f.required}
                style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0, overflow: 'hidden' }}
              />
            </label>
          ) : null}
          {f.isPayment ? (() => {
            const status = f.payStatus;
            const config = f.payConfig;
            const paid = status?.status === 'succeeded';
            const processing = status?.status === 'processing';
            const failed = status?.status === 'failed';
            const cents = status?.amount_cents ?? config?.amount_cents ?? null;
            const currency = status?.currency ?? config?.currency ?? 'usd';
            const amountLabel = cents !== null
              ? formatPayCents(cents, currency)
              : (config?.amount_mode === 'signer_entered' ? 'Enter amount' : '…');
            const memo = status?.description ?? config?.memo ?? null;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', width: '100%', height: '100%', padding: '2px 6px', textAlign: 'center', overflow: 'hidden' }}>
                {paid ? (
                  <>
                    <span style={{ fontSize: '.71875rem', fontWeight: 700, color: '#047857', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="check" size={12} />{'Paid ' + formatPayCents(status!.amount_cents, status!.currency)}
                    </span>
                    {status?.receipt_url ? (
                      <a href={status.receipt_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.625rem', color: '#0f766e' }}>
                        View receipt
                      </a>
                    ) : null}
                  </>
                ) : processing ? (
                  <span role="status" style={{ fontSize: '.6875rem', fontWeight: 600, color: '#b45309' }}>Confirming your payment…</span>
                ) : (
                  <button
                    type="button"
                    onClick={f.onPayClick}
                    disabled={readOnly || !onPay}
                    aria-label={f.aria}
                    style={{
                      border: 'none', background: 'transparent', cursor: (readOnly || !onPay) ? 'default' : 'pointer',
                      display: 'flex', flexDirection: 'column', gap: '2px', width: '100%', height: '100%',
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <span style={{ fontSize: '.75rem', fontWeight: 700, color: !onPay ? TEXT_MUTED : '#0f172a' }}>{'Pay ' + amountLabel}</span>
                    {memo ? <span style={{ fontSize: '.625rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{memo}</span> : null}
                    {!onPay ? <span style={{ fontSize: '.5625rem', color: TEXT_MUTED }}>Preview only · no charge</span> : null}
                    {failed ? <span style={{ fontSize: '.5625rem', color: '#b91c1c' }}>Card declined · try again</span> : null}
                  </button>
                )}
              </div>
            );
          })() : null}
          {f.isText ? (
            <input
              type={f.inputType}
              inputMode={f.inputMode}
              value={f.value}
              onChange={f.isPicker && f.inputType !== 'text' ? f.onPickerChange : f.onChange}
              onBlur={f.onCommit}
              readOnly={readOnly}
              placeholder={f.placeholder}
              aria-label={f.aria}
              aria-required={f.required}
              aria-invalid={f.problem ? true : undefined}
              aria-describedby={f.problem ? f.id + '-problem' : undefined}
              style={f.inputStyle}
            />
          ) : null}
          {f.isNext ? (
            <span style={f.nextStyle} aria-hidden="true">
              <Icon name="arrowRight" size={9} />
              {f.nextHint}
            </span>
          ) : null}
          {f.problem ? (
            <span
              id={f.id + '-problem'}
              role="alert"
              style={{
                position: 'absolute', left: 0, top: '100%', marginTop: '3px', maxWidth: '260px',
                fontSize: '.65625rem', lineHeight: 1.4, color: '#b91c1c', background: '#fff',
                border: '1px solid #fecaca', borderRadius: '6px', padding: '3px 6px', whiteSpace: 'normal',
              }}
            >
              {f.problem}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );

  const paper = pdfUrl ? (
    <LazyPdfPages
      fileUrl={pdfUrl}
      pages={pages}
      containerWidth={availableWidth}
      maxWidth={816}
      renderOverlay={(g) => fieldNodes(g.page, g.scale)}
    />
  ) : (
    /* No PDF URL: the sender's in-app preview of an envelope whose file is not
       reachable from this route. Say so rather than paint invented prose. */
    <div role="status" style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '22px 20px', fontSize: '.78125rem', color: '#475569', lineHeight: 1.6 }}>
      The document itself is not available on this screen. Field positions below are the ones that will be applied to the uploaded PDF.
    </div>
  );

  if (viewOnly) {
    /* A `copy` (CC) recipient. They receive the document, not a ceremony. */
    return (
      <section data-screen-label="Signing" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#eceff4' }}>
        <div style={{ flex: '0 0 auto', background: '#fff', borderBottom: '1px solid #e3e7ee', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1, minWidth: '200px' }}>
            <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>You have been copied on this envelope</span>
            <span style={{ fontSize: '.71875rem', color: '#64748b' }}>Nothing is required of you — there is no signature to apply and no field to complete.</span>
          </div>
          <button type="button" onClick={() => { if (onDownload) onDownload(); else go('audit'); }} style={ghostBtn}>Download a copy</button>
        </div>
        <div data-sf-scroll="1" ref={attachScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 14px' }}>
          {paper}
        </div>
      </section>
    );
  }

  return (
    <section data-screen-label="Signing" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#eceff4' }}>
      <div style={{ flex: '0 0 auto', background: '#fff', borderBottom: '1px solid #e3e7ee', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '180px', flex: '1 1 200px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{done + ' of ' + req.length + ' required fields completed'}</span>
            <span style={signPctStyle}>{String(pct)}%</span>
          </div>
          <div style={{ height: '6px', borderRadius: '99px', background: '#eef1f6', overflow: 'hidden', maxWidth: '420px' }}>
            <div style={signBarStyle}></div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-start' }}>
          <button type="button" onClick={nextField} style={primaryBtn}>{nextFieldLabel}</button>
          {/* Named and located, so the button is a destination rather than a leap. */}
          <span aria-live="polite" style={{ fontSize: '.6875rem', color: '#64748b', maxWidth: '240px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {guideLabel ? 'Next: ' + guideLabel : 'Nothing left to complete'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          <button type="button" onClick={runOr(onDisclosure, 'disclosure')} style={ghostBtn}>Disclosure</button>
          <button type="button" onClick={runOr(onDecline, 'decline')} style={ghostBtn}>Decline</button>
          <button type="button" onClick={runOr(onReassign, 'reassign')} style={ghostBtn}>Reassign</button>
          <button type="button" onClick={finish} style={successBtn}>Finish</button>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* The guide: parked in the bottom-left corner of the *viewport* for the
          whole ceremony, pointing the way the outstanding field lies.
          Fixed rather than absolute — the signing surface is not always the
          thing that scrolls, and an absolute corner then sits below the fold,
          which is precisely where a signer looking for help cannot see it. */}
      {target && guideText ? (
        <button
          type="button"
          onClick={nextField}
          aria-label={guideText}
          style={{
            position: 'fixed', zIndex: 40, left: '14px', bottom: '16px',
            display: 'flex', alignItems: 'center', gap: '7px', maxWidth: 'calc(100vw - 28px)',
            height: '34px', padding: '0 14px', borderRadius: '99px', cursor: 'pointer',
            border: '1px solid ' + A, background: A, color: '#fff',
            fontSize: '.75rem', fontWeight: 600, fontFamily: 'var(--font-sans)',
            boxShadow: '0 10px 24px -10px rgba(15,23,42,.55)',
          }}
        >
          <Icon name={guideIcon} size={12} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {guideText}
          </span>
        </button>
      ) : null}
      <div data-sf-scroll="1" ref={attachScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 14px' }}>
        <div style={{ maxWidth: '816px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {paper}
          <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '.75rem', color: '#64748b', maxWidth: '520px', lineHeight: 1.5 }}>Adopting a signature is your electronic representation. Once applied, it is bound to this envelope with a SHA-256 hash and a tamper-evident audit trail.</div>
            <button type="button" onClick={() => { if (onDownload) onDownload(); else go('audit'); }} style={ghostBtn}>Download unsigned PDF</button>
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
