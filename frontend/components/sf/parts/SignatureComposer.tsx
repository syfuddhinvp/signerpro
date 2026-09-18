'use client';

/* The signature composer — draw, type, upload, re-use.
 *
 * This is the panel the document signing modal has always shown. The account
 * page needs the same thing (adopting a signature and signing with one are the
 * same act of authorship), and a second, simpler composer there would mean a
 * signature that looks one way on the profile and another on the document.
 * So it lives here and both callers render it.
 *
 * The composer owns no result state: `composeRef` is filled with a function
 * that reads whatever the active tab holds. The caller keeps its own footer,
 * because what "adopt" means differs — the signing modal writes a field value,
 * the account page POSTs a saved signature. */

import type { CSSProperties, MutableRefObject } from 'react';
import React, { useEffect, useRef } from 'react';
import { useSF } from '@/lib/sf/state';
import { SIG_TABS, TYPE_FACES, INKS } from '@/lib/sf/data';
import { btn, inputStyle, TEXT_MUTED } from '@/lib/sf/ui';
import type { SavedSignatureResponse } from '@/lib/api/types';
import { typeFaceStack } from '@/lib/sf/fonts';
import Icon from '@/components/sf/Icon';

export type SigTabId = 'draw' | 'type' | 'upload' | 'saved';

/** What the active tab holds, in the shape `POST /api/me/signatures` takes. */
export type ComposedSignature = {
  signature_type: 'typed' | 'drawn' | 'uploaded';
  signature_text: string | null;
  type_face: string | null;
  /** A `data:` URL for drawn and uploaded signatures. */
  signature_image_base64: string | null;
};

export type SignatureComposerProps = {
  /** Which tabs to offer. The account page has no field to re-use a saved
   *  signature into, so it leaves `saved` out. */
  tabs?: SigTabId[];
  /** Accent colour, from the caller's `accent()`. */
  accent: string;
  /** Filled with a reader for the active tab. Returns `null` — after flashing
   *  why — when the tab has nothing in it yet. */
  composeRef: MutableRefObject<(() => ComposedSignature | null) | null>;
  /** `null` while loading. Only used by the `saved` tab. */
  savedSignatures?: SavedSignatureResponse[] | null;
  onPickSaved?: (row: SavedSignatureResponse) => void;
};

export default function SignatureComposer({
  tabs = ['draw', 'type', 'upload', 'saved'],
  accent: A,
  composeRef,
  savedSignatures = null,
  onPickSaved,
}: SignatureComposerProps) {
  const { s, set, flash } = useSF();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasStrokes = useRef(false);
  const stateRef = useRef(s);
  stateRef.current = s;

  /* A caller that hides a tab must not be left sitting on it. */
  const allowed = tabs as string[];
  useEffect(() => {
    if (!allowed.includes(s.sigTab)) set({ sigTab: tabs[0] });
  }, [allowed, s.sigTab, set, tabs]);

  const sigTabs = SIG_TABS.filter(([id]) => allowed.includes(id)).map(([id, label]) => {
    const on = s.sigTab === id;
    return {
      id, label, selected: on,
      onClick: () => set({ sigTab: id }),
      style: {
        flex: '1', height: '30px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '.78125rem',
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
        fontFamily: typeFaceStack(name), fontSize: '1.625rem', color: '#0f172a', lineHeight: 1.1,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%'
      } as CSSProperties
    };
  });

  const savedSigs = (savedSignatures ?? []).map(x => ({
    key: x.id,
    row: x,
    name: x.signature_text || s.typedName,
    label: 'Adopted ' + new Date(x.adopted_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }),
    meta: [x.signature_type, x.is_passkey_bound ? 'passkey-bound' : null].filter(Boolean).join(' · '),
    style: {
      display: 'flex', alignItems: 'center', gap: '14px', padding: '11px 13px', borderRadius: '12px',
      border: '1px solid #e3e7ee', background: '#fbfcfd', cursor: 'pointer', width: '100%'
    } as CSSProperties,
    preview: { fontFamily: typeFaceStack(x.type_face || x.face), fontSize: '1.625rem', color: '#0f172a' } as CSSProperties
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

  composeRef.current = () => {
    const st = stateRef.current;
    if (st.sigTab === 'draw') {
      const image = canvasRef.current && hasStrokes.current ? canvasRef.current.toDataURL('image/png') : null;
      if (!image) { flash('Draw your signature first'); return null; }
      return { signature_type: 'drawn', signature_text: st.typedName || null, type_face: null, signature_image_base64: image };
    }
    if (st.sigTab === 'upload') {
      if (!st.uploadSrc) { flash('Upload an image first'); return null; }
      return { signature_type: 'uploaded', signature_text: st.typedName || null, type_face: null, signature_image_base64: st.uploadSrc };
    }
    /* `type` and `saved` both resolve to typed text in the chosen face: the
       saved tab's rows set exactly those two values when they are picked. */
    if (!st.typedName.trim()) { flash('Type your name first'); return null; }
    return { signature_type: 'typed', signature_text: st.typedName, type_face: st.typeFace, signature_image_base64: null };
  };

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
            style={{ width: '100%', height: '180px', background: '#fbfcfd', border: '1px dashed #8492a6', borderRadius: '12px', touchAction: 'none', cursor: 'crosshair' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '.71875rem', color: '#64748b' }}>Ink</span>
              {inks.map(i => (
                <button key={i.c} type="button" aria-label={i.aria} onClick={i.onClick} style={i.style} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '.71875rem', color: '#64748b' }}>Stroke</span>
              <input
                type="range" min="1" max="9" step="1"
                value={String(s.sigStroke)}
                onChange={(e) => set({ sigStroke: parseInt(e.target.value, 10) })}
                aria-label="Stroke thickness"
                style={{ width: '120px', accentColor: '#4f46e5' }}
              />
              <span style={{ fontSize: '.71875rem', fontFamily: 'var(--font-sans)', color: '#334155' }}>{String(s.sigStroke)}px</span>
            </div>
            <button type="button" onClick={clearCanvas} style={ghostBtn}><Icon name="trash" size={13} />Clear</button>
            <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, marginLeft: 'auto' }}>Bézier smoothing · stylus &amp; touch supported</span>
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
                <span style={{ fontSize: '.65625rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {s.sigTab === 'upload' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <label style={{ border: '1px dashed #8492a6', borderRadius: '12px', padding: '24px', textAlign: 'center', background: '#fbfcfd', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>Drop a PNG or JPG of your signature</span>
            <span style={{ fontSize: '.71875rem', color: '#64748b' }}>Background is filtered to transparency automatically</span>
            <input type="file" accept="image/*" onChange={onUpload} style={{ margin: '9px auto 0', fontSize: '.75rem' }} />
          </label>
          {s.uploadSrc ? (
            <div style={{ border: '1px solid #eef1f6', borderRadius: '12px', padding: '12px', display: 'flex', alignItems: 'center', gap: '12px', background: '#fff' }}>
              <span style={{ display: 'flex' }}>
                <img src={s.uploadSrc} alt="Uploaded signature preview" style={{ height: '64px', objectFit: 'contain' }} />
              </span>
              <span style={{ fontSize: '.71875rem', color: '#64748b' }}>Transparency filter applied · 1 layer</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {s.sigTab === 'saved' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {savedSignatures === null ? (
            <span style={{ fontSize: '.71875rem', color: TEXT_MUTED }}>Loading your adopted signatures…</span>
          ) : savedSigs.length === 0 ? (
            <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, lineHeight: 1.6 }}>You have not adopted a signature yet. Draw, type or upload one on the other tabs.</span>
          ) : null}
          {savedSigs.map(sig => (
            <button key={sig.key} type="button" onClick={() => onPickSaved?.(sig.row)} style={sig.style}>
              <span style={sig.preview}>{sig.name}</span>
              <span style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', gap: '2px', marginLeft: 'auto' }}>
                <span style={{ fontSize: '.71875rem', color: '#475569', fontWeight: 600 }}>{sig.label}</span>
                <span style={{ fontSize: '.65625rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>{sig.meta}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
