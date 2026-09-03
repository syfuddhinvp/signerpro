'use client';

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useDocumentTitle, useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import type { Recipient, SFField } from '@/lib/sf/state';
import type { SignerField } from '@/lib/sf/adapters';
import { btn } from '@/lib/sf/ui';
import { effectiveValidation, fieldValueProblem, fitsNativeInput, nativeInputType } from '@/lib/sf/fieldValidation';
import LazyPdfPages from '@/components/sf/pdf/LazyPdfPages';
import { useElementWidth } from '@/components/sf/pdf/useElementWidth';

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
  pdfUrl, otherPlacements, onUploadAttachment, stampEndpoint, viewOnly = false,
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
  const complete = (f: SignerField | SFField) => isDone(f) && !problemFor(f);
  const req = signList.filter(f => f.required);
  const done = req.filter(f => complete(f)).length;
  const pct = req.length ? Math.round((done / req.length) * 100) : 100;

  const nextField = () => {
    const pending = signList.filter(f => f.required && !complete(f));
    if (!pending.length) { flash('All required fields complete — ready to finish'); return; }
    const f = pending[0];
    const el = signEls.current[f.id];
    if (el && signScroll.current) signScroll.current.scrollTop = Math.max(0, el.offsetTop - 160);
    set({ activeSignField: f.id });
    if (f.type === 'signature' || f.type === 'initials') {
      if (onOpenSignature) onOpenSignature(f.id);
      else set({ modal: 'signature' });
    }
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
      const el = signEls.current[broken.id];
      if (el && signScroll.current) signScroll.current.scrollTop = Math.max(0, el.offsetTop - 160);
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
  const successBtn = btn('#059669', '#fff', '#059669');
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const signPctStyle: CSSProperties = { fontSize: '.71875rem', fontWeight: 700, fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: pct === 100 ? '#047857' : A };
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
    const filled = isDone(f);
    const options = (f as SignerField).options ?? [];
    const problem = fieldValueProblem(f, v);
    const kind = effectiveValidation(f);
    return {
      id: f.id,
      page: f.page || 1,
      box: {
        position: 'absolute', left: (f.x * scale) + 'px', top: (f.y * scale) + 'px', width: (f.w * scale) + 'px', height: (f.h * scale) + 'px',
        border: '1.5px solid ' + (problem ? '#dc2626' : (filled ? '#10b981' : r.color)), borderRadius: '6px',
        background: problem ? '#fef2f2' : (filled ? '#ecfdf5' : r.color + '14'),
        boxShadow: active ? '0 0 0 4px ' + r.color + '40' : 'none', display: 'flex', alignItems: 'center', padding: '2px'
      } as CSSProperties,
      tag: {
        position: 'absolute', top: '-9px', left: '-1px', height: '17px', padding: '0 6px', borderRadius: '5px',
        background: problem ? '#dc2626' : (filled ? '#10b981' : r.color), color: '#fff', fontSize: '.59375rem', fontWeight: 700, display: 'flex', alignItems: 'center', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", whiteSpace: 'nowrap'
      } as CSSProperties,
      tagText: (problem ? '! ' : (filled ? '✓ ' : (f.required ? '* ' : ''))) + t.label,
      aria: t.label + ' — ' + f.label + (f.required ? ' (required)' : ''),
      isSig, isCheck: f.type === 'checkbox',
      /* A Radio Group is a set of radio buttons, not a dropdown. Both used to
         render the same `<select>`, so a field the sender placed as a radio
         group asked the signer to "Select…" from a menu. */
      isSelect: f.type === 'dropdown',
      isRadio: f.type === 'radio',
      isAttachment: f.type === 'attachment',
      /* A stamp is a mark on the page — a seal, a chop, a logo — so it is an
         image upload, and the executed PDF draws the image. It used to render
         as a plain text box, which meant the signer typed a word where a seal
         belonged. */
      isStamp: f.type === 'stamp',
      isText: !isSig && f.type !== 'checkbox' && f.type !== 'dropdown' && f.type !== 'radio'
        && f.type !== 'attachment' && f.type !== 'stamp',
      /** Images only; a PDF cannot be drawn into the stamp's box. */
      fileAccept: f.type === 'stamp' ? 'image/png,image/jpeg,image/gif,image/webp' : undefined,
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
      typedStyle: { fontFamily: "'" + (typed ? typed[1] : 'Caveat') + "', cursive", fontSize: Math.max(10, Math.min(30, f.h * scale - 18)) + 'px', color: '#0f172a', lineHeight: 1 } as CSSProperties,
      sigBtn: { width: '100%', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' } as CSSProperties,
      onSign: () => openSig(f.id),
      /** Real dropdown choices when the field was authored with them. */
      options,
      checked: v === true,
      checkMark: v === true ? '✓' : '',
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

  const fieldNodes = (page: number, scale: number) => (
    <>
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
        <div key={f.id} ref={(el) => { if (el) signEls.current[f.id] = el; }} style={f.box}>
          <span style={f.tag}>{f.tagText}</span>
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
            <button type="button" role="checkbox" aria-checked={f.checked} aria-label={f.aria} onClick={f.onCheck} style={f.checkStyle}>{f.checkMark}</button>
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
              <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{f.value ? '✓ ' + f.value : 'Choose file'}</span>
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
        <button type="button" onClick={nextField} style={primaryBtn}>{nextFieldLabel}</button>
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          <button type="button" onClick={runOr(onDisclosure, 'disclosure')} style={ghostBtn}>Disclosure</button>
          <button type="button" onClick={runOr(onDecline, 'decline')} style={ghostBtn}>Decline</button>
          <button type="button" onClick={runOr(onReassign, 'reassign')} style={ghostBtn}>Reassign</button>
          <button type="button" onClick={finish} style={successBtn}>Finish</button>
        </div>
      </div>

      <div data-sf-scroll="1" ref={attachScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 14px' }}>
        <div style={{ maxWidth: '816px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {paper}
          <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '.75rem', color: '#64748b', maxWidth: '520px', lineHeight: 1.5 }}>Adopting a signature is your electronic representation. Once applied, it is bound to this envelope with a SHA-256 hash and a tamper-evident audit trail.</div>
            <button type="button" onClick={() => { if (onDownload) onDownload(); else go('audit'); }} style={ghostBtn}>Download unsigned PDF</button>
          </div>
        </div>
      </div>
    </section>
  );
}
