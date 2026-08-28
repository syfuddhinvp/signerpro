'use client';

import type { CSSProperties } from 'react';
import { useRef } from 'react';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import type { SFField } from '@/lib/sf/state';
import { btn } from '@/lib/sf/ui';

export default function Signer() {
  const { s, set, flash, accent, recip, meta, signable, isDone } = useSF();
  const { go } = useNav();
  const A = accent();

  const signEls = useRef<Record<string, HTMLDivElement | null>>({});
  const signScroll = useRef<HTMLDivElement | null>(null);

  const signList = signable();
  const req = signList.filter(f => f.required);
  const done = req.filter(f => isDone(f)).length;
  const pct = req.length ? Math.round((done / req.length) * 100) : 100;

  const nextField = () => {
    const pending = signable().filter(f => f.required && !isDone(f));
    if (!pending.length) { flash('All required fields complete — ready to finish'); return; }
    const f = pending[0];
    const el = signEls.current[f.id];
    if (el && signScroll.current) signScroll.current.scrollTop = Math.max(0, el.offsetTop - 160);
    set({ activeSignField: f.id });
    if (f.type === 'signature' || f.type === 'initials') set({ modal: 'signature' });
  };

  const openSig = (id: string) => set({ modal: 'signature', activeSignField: id, sigTab: 'draw' });

  const finish = () => {
    if (pct < 100) { flash('Complete all required fields first'); nextField(); }
    else { go('audit'); flash('Envelope completed · certificate sealed'); }
  };

  const primaryBtn = btn(A, '#fff', A);
  const successBtn = btn('#059669', '#fff', '#059669');
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const signPctStyle: CSSProperties = { fontSize: '11.5px', fontWeight: 700, fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: pct === 100 ? '#047857' : A };
  const signBarStyle: CSSProperties = { width: pct + '%', height: '100%', borderRadius: '99px', background: pct === 100 ? '#10b981' : A, transition: 'width .25s ease' };
  const nextFieldLabel = done === 0 ? 'Start signing' : (pct === 100 ? 'All fields complete' : 'Next required field');
  const signSheetStyle: CSSProperties = { position: 'relative', width: '816px', height: '1056px', background: '#fff', borderRadius: '3px', boxShadow: '0 24px 60px -24px rgba(15,23,42,.35), 0 0 0 1px #dfe4ec' };

  const signFields = signList.map((f: SFField) => {
    const r = recip(f.to), t = meta(f.type);
    const v = s.signValues[f.id];
    const isSig = f.type === 'signature' || f.type === 'initials';
    const typed = typeof v === 'string' && v.indexOf('typed:') === 0 ? v.split(':') : null;
    const active = s.activeSignField === f.id;
    const filled = isDone(f);
    return {
      id: f.id,
      box: {
        position: 'absolute', left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px',
        border: '1.5px solid ' + (filled ? '#10b981' : r.color), borderRadius: '6px',
        background: filled ? '#ecfdf5' : r.color + '14',
        boxShadow: active ? '0 0 0 4px ' + r.color + '40' : 'none', display: 'flex', alignItems: 'center', padding: '2px'
      } as CSSProperties,
      tag: {
        position: 'absolute', top: '-9px', left: '-1px', height: '17px', padding: '0 6px', borderRadius: '5px',
        background: filled ? '#10b981' : r.color, color: '#fff', fontSize: '9.5px', fontWeight: 700, display: 'flex', alignItems: 'center', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", whiteSpace: 'nowrap'
      } as CSSProperties,
      tagText: (filled ? '✓ ' : (f.required ? '* ' : '')) + t.label,
      aria: t.label + ' — ' + f.label + (f.required ? ' (required)' : ''),
      isSig, isCheck: f.type === 'checkbox', isSelect: f.type === 'dropdown',
      isText: !isSig && f.type !== 'checkbox' && f.type !== 'dropdown',
      required: f.required ? true : false,
      value: v && !typed ? String(v) : '',
      placeholder: f.placeholder || f.label,
      cta: f.type === 'initials' ? 'Initial' : 'Sign here',
      empty: !v,
      hasImage: !!(v && String(v).indexOf('data:') === 0),
      imgWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' } as CSSProperties,
      imgSrc: v && String(v).indexOf('data:') === 0 ? String(v) : null,
      imgStyle: { maxHeight: (f.h - 12) + 'px', maxWidth: '100%', objectFit: 'contain' } as CSSProperties,
      hasTyped: !!typed,
      typedText: typed ? typed.slice(2).join(':') : '',
      typedStyle: { fontFamily: "'" + (typed ? typed[1] : 'Caveat') + "', cursive", fontSize: Math.min(30, f.h - 18) + 'px', color: '#0f172a', lineHeight: 1 } as CSSProperties,
      sigBtn: { width: '100%', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center' } as CSSProperties,
      onSign: () => openSig(f.id),
      checked: v === true,
      checkMark: v === true ? '✓' : '',
      checkStyle: { width: '100%', height: '100%', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '16px', color: '#047857', fontWeight: 700 } as CSSProperties,
      onCheck: () => set(st => ({ signValues: Object.assign({}, st.signValues, { [f.id]: st.signValues[f.id] === true ? false : true }) })),
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const val = e.target.value;
        set(st => ({ signValues: Object.assign({}, st.signValues, { [f.id]: val }) }));
      },
      inputStyle: { width: '100%', height: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '12.5px', padding: '0 7px', color: '#0f172a' } as CSSProperties
    };
  });

  return (
    <section data-screen-label="Signing" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#eceff4' }}>
      <div style={{ flex: '0 0 auto', background: '#fff', borderBottom: '1px solid #e3e7ee', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '230px', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{done + ' of ' + req.length + ' required fields completed'}</span>
            <span style={signPctStyle}>{String(pct)}%</span>
          </div>
          <div style={{ height: '6px', borderRadius: '99px', background: '#eef1f6', overflow: 'hidden', maxWidth: '420px' }}>
            <div style={signBarStyle}></div>
          </div>
        </div>
        <button type="button" onClick={nextField} style={primaryBtn}>{nextFieldLabel}</button>
        <div style={{ display: 'flex', gap: '7px' }}>
          <button type="button" onClick={() => set({ modal: 'disclosure' })} style={ghostBtn}>Disclosure</button>
          <button type="button" onClick={() => set({ modal: 'decline' })} style={ghostBtn}>Decline</button>
          <button type="button" onClick={() => set({ modal: 'reassign' })} style={ghostBtn}>Reassign</button>
          <button type="button" onClick={finish} style={successBtn}>Finish</button>
        </div>
      </div>

      <div data-sf-scroll="1" ref={signScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '24px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '816px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={signSheetStyle}>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', padding: '64px 72px', display: 'flex', flexDirection: 'column', gap: '13px', opacity: .6 }}>
              <div style={{ fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontSize: '10px', letterSpacing: '.14em', color: '#94a3b8' }}>MASTER SERVICES AGREEMENT — SIGNATURE PAGE</div>
              <div style={{ fontSize: '21px', fontWeight: 700, letterSpacing: '-.4px' }}>Execution</div>
              <div style={{ fontSize: '11.5px', lineHeight: 1.75, color: '#475569', maxWidth: '600px' }}>By signing below, each party acknowledges it has reviewed the Electronic Record and Signature Disclosure and consents to transact business electronically. The signatory represents that they are authorised to bind the entity on whose behalf they sign.</div>
              <div style={{ fontSize: '11.5px', lineHeight: 1.75, color: '#475569', maxWidth: '600px' }}>Executed effective the last date written below. Counterparts delivered electronically shall be deemed originals for all purposes, including enforcement and archival.</div>
            </div>
            {signFields.map(f => (
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
                    {f.empty ? (<span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>{f.cta}</span>) : null}
                  </button>
                ) : null}
                {f.isCheck ? (
                  <button type="button" role="checkbox" aria-checked={f.checked} aria-label={f.aria} onClick={f.onCheck} style={f.checkStyle}>{f.checkMark}</button>
                ) : null}
                {f.isSelect ? (
                  <select value={f.value} onChange={f.onChange} aria-label={f.aria} style={f.inputStyle}>
                    <option value="">Select…</option>
                    <option value="Net 30">Net 30</option>
                    <option value="Net 45">Net 45</option>
                    <option value="Net 60">Net 60</option>
                  </select>
                ) : null}
                {f.isText ? (
                  <input type="text" value={f.value} onChange={f.onChange} placeholder={f.placeholder} aria-label={f.aria} aria-required={f.required} style={f.inputStyle} />
                ) : null}
              </div>
            ))}
          </div>
          <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '12px', color: '#64748b', maxWidth: '520px', lineHeight: 1.5 }}>Adopting a signature is your electronic representation. Once applied, it is bound to this envelope with a SHA-256 hash and a tamper-evident audit trail.</div>
            <button type="button" onClick={() => go('audit')} style={ghostBtn}>Download unsigned PDF</button>
          </div>
        </div>
      </div>
    </section>
  );
}
