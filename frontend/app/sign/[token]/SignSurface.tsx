'use client';

/**
 * The public signing surface: the designed `Signer` screen, wired to the token
 * endpoints, plus the ceremonies the in-app `Modals` host provides for the
 * sender (signature adoption, disclosure, decline, reassign). Those modals are
 * re-implemented here from the same style atoms because `Modals` is mounted by
 * the authenticated layout only, and this route has no session at all.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Signer from '@/components/sf/screens/Signer';
import { useSF, type Recipient, type SFField } from '@/lib/sf/state';
import type { SignerField } from '@/lib/sf/adapters';
import { btn, inputStyle } from '@/lib/sf/ui';
import type { OtherPlacement } from '@/components/sf/screens/Signer';
import {
  completeSigning, declineSigning, markViewed, reassignSigning, saveFieldValue, saveSignature,
  uploadAttachment, type ActionResult,
} from './actions';

export type SignSurfaceProps = {
  token: string;
  fields: SignerField[];
  recipients: Recipient[];
  initialValues: Record<string, unknown>;
  pageCount: number;
  readOnly: boolean;
  canDecline: boolean;
  canReassign: boolean;
  signerName: string;
  documentTitle: string;
  /** `/api/sign/{token}/pdf`, proxied through this route's own PDF handler.
   *  Both the download button and the rendered document read from it. */
  pdfHref: string;
  consentVersion: string;
  /** Other recipients' placements, redacted to geometry by the API. */
  otherPlacements: OtherPlacement[];
};

type ModalKind = 'signature' | 'disclosure' | 'decline' | 'reassign' | null;

const TYPE_FACES = ['Caveat', 'Dancing Script', 'Great Vibes'];

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.55)',
  display: 'grid', placeItems: 'center', padding: '24px',
};
const card = (width: string): CSSProperties => ({
  width, maxWidth: '100%', maxHeight: '90vh', overflow: 'auto', background: '#fff',
  border: '1px solid #e3e7ee', borderRadius: '16px', boxShadow: '0 30px 70px -30px rgba(15,23,42,.5)',
});
const cardHead: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px',
  padding: '16px 18px', borderBottom: '1px solid #eef1f6',
};
const cardBody: CSSProperties = { padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' };
const textareaStyle: CSSProperties = {
  border: '1px solid #e3e7ee', borderRadius: '9px', padding: '8px 10px', fontSize: '.78125rem',
  resize: 'vertical', outline: 'none', width: '100%', color: '#0f172a',
};
const iconBtn: CSSProperties = {
  width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee',
  background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: '.75rem',
};
const tab = (on: boolean): CSSProperties => ({
  height: '30px', padding: '0 13px', borderRadius: '8px', border: 'none', cursor: 'pointer',
  fontSize: '.78125rem', fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent',
  color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
});

export default function SignSurface(props: SignSurfaceProps) {
  const {
    token, fields, recipients, initialValues, pageCount, readOnly,
    canDecline, canReassign, signerName, documentTitle, pdfHref, consentVersion, otherPlacements,
  } = props;
  const { s, set, flash } = useSF();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [modal, setModal] = useState<ModalKind>(null);
  const [sigTab, setSigTab] = useState<'draw' | 'type'>('draw');
  const [typedName, setTypedName] = useState(signerName);
  const [typeFace, setTypeFace] = useState(TYPE_FACES[0]);
  const [declineReason, setDeclineReason] = useState('');
  const [reassign, setReassign] = useState({ name: '', email: '', reason: '' });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasStrokes = useRef(false);
  const drawing = useRef(false);
  const activeField = useRef<string | null>(null);
  const viewed = useRef(false);

  /* The audit trail's `document_viewed` entry: once, on first open. */
  useEffect(() => {
    if (viewed.current || readOnly) return;
    viewed.current = true;
    void markViewed(token);
  }, [token, readOnly]);

  const apply = useCallback((run: () => Promise<ActionResult>, optimistic?: string) => {
    if (optimistic) flash(optimistic);
    startTransition(async () => {
      const result = await run();
      if (!result.ok) { flash('Could not save · ' + result.message); router.refresh(); return; }
      if (!optimistic) flash(result.message);
      router.refresh();
    });
  }, [flash, router, startTransition]);

  /* ── field values ── */
  const onSaveValue = (field: SFField, value: string | boolean) => {
    if (readOnly) return;
    apply(() => saveFieldValue(token, field.id, value));
  };

  const onUploadAttachment = (field: SFField, file: File) => {
    if (readOnly) return;
    const form = new FormData();
    form.append('upload', file, file.name);
    apply(() => uploadAttachment(token, field.id, form), 'Uploading ' + file.name + '…');
  };

  /* ── signature ceremony ── */
  const openSignature = (fieldId: string) => {
    activeField.current = fieldId;
    hasStrokes.current = false;
    setSigTab('draw');
    setModal('signature');
  };

  const canvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    const point = canvasPoint(e);
    if (!ctx || !point) return;
    drawing.current = true;
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    ctx.beginPath(); ctx.moveTo(point.x, point.y);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const point = canvasPoint(e);
    if (!ctx || !point) return;
    ctx.lineTo(point.x, point.y); ctx.stroke();
    hasStrokes.current = true;
  };
  const onPointerUp = () => { drawing.current = false; };
  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
  };

  const adopt = () => {
    const fieldId = activeField.current;
    if (!fieldId) return;
    if (sigTab === 'draw') {
      if (!canvasRef.current || !hasStrokes.current) { flash('Draw your signature first'); return; }
      const dataUrl = canvasRef.current.toDataURL('image/png');
      set(st => ({ signValues: Object.assign({}, st.signValues, { [fieldId]: dataUrl }), modal: null }));
      setModal(null);
      apply(() => saveSignature(token, fieldId, {
        signature_type: 'drawn', signature_text: typedName || signerName, signature_image_base64: dataUrl,
      }), 'Signature applied · sealed with SHA-256 and logged');
      return;
    }
    const text = (typedName || signerName).trim();
    if (!text) { flash('Type your name first'); return; }
    set(st => ({ signValues: Object.assign({}, st.signValues, { [fieldId]: `typed:${typeFace}:${text}` }), modal: null }));
    setModal(null);
    apply(() => saveSignature(token, fieldId, { signature_type: 'typed', signature_text: text }),
      'Signature applied · sealed with SHA-256 and logged');
  };

  /* ── finish / decline / reassign ── */
  const finish = () => apply(() => completeSigning(token));
  const confirmDecline = () => {
    if (!canDecline) { flash('This envelope can no longer be declined'); return; }
    setModal(null);
    apply(() => declineSigning(token, declineReason));
  };
  const confirmReassign = () => {
    if (!canReassign) { flash('This envelope can no longer be reassigned'); return; }
    setModal(null);
    apply(() => reassignSigning(token, reassign));
  };

  const primaryBtn = btn('#4f46e5', '#fff', '#4f46e5');
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const dangerBtn = btn('#b91c1c', '#fff', '#b91c1c');

  return (
    <>
      <Signer
        fields={fields}
        recipients={recipients}
        pageCount={pageCount}
        readOnly={readOnly}
        initialValues={initialValues}
        onSaveValue={onSaveValue}
        onOpenSignature={openSignature}
        onDisclosure={() => setModal('disclosure')}
        onDecline={() => (canDecline ? setModal('decline') : flash('This envelope can no longer be declined'))}
        onReassign={() => (canReassign ? setModal('reassign') : flash('This envelope can no longer be reassigned'))}
        onFinish={finish}
        onDownload={() => window.open(pdfHref, '_blank', 'noopener')}
        pdfUrl={pdfHref}
        otherPlacements={otherPlacements}
        onUploadAttachment={onUploadAttachment}
        stampEndpoint={(fieldId) => `/sign/${encodeURIComponent(token)}/fields/${encodeURIComponent(fieldId)}/attachment`}
      />

      {modal === 'signature' ? (
        <div role="dialog" aria-modal="true" aria-label="Adopt your signature" style={overlay}>
          <div style={card('680px')}>
            <div style={cardHead}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>Adopt your signature</span>
                <span style={{ fontSize: '.75rem', color: '#64748b' }}>Draw or type — it is bound to this envelope with a SHA-256 hash</span>
              </div>
              <button type="button" aria-label="Close" onClick={() => setModal(null)} style={iconBtn}>✕</button>
            </div>
            <div style={cardBody}>
              <div role="tablist" aria-label="Signature method" style={{ display: 'flex', gap: '4px', background: '#f5f6f8', padding: '4px', borderRadius: '11px' }}>
                <button type="button" role="tab" aria-selected={sigTab === 'draw'} onClick={() => setSigTab('draw')} style={tab(sigTab === 'draw')}>Draw</button>
                <button type="button" role="tab" aria-selected={sigTab === 'type'} onClick={() => setSigTab('type')} style={tab(sigTab === 'type')}>Type</button>
              </div>
              {sigTab === 'draw' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <canvas
                    ref={canvasRef}
                    width={620}
                    height={200}
                    aria-label="Draw your signature"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                    style={{ width: '100%', height: '200px', touchAction: 'none', background: '#fbfcfd', border: '1px dashed #8492a6', borderRadius: '12px', cursor: 'crosshair' }}
                  />
                  <button type="button" onClick={clearCanvas} style={ghostBtn}>Clear</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <input
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    aria-label="Typed signature text"
                    placeholder="Full legal name"
                    style={inputStyle}
                  />
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {TYPE_FACES.map(face => (
                      <button
                        key={face}
                        type="button"
                        onClick={() => setTypeFace(face)}
                        aria-pressed={typeFace === face}
                        style={{ flex: '1 1 160px', minHeight: '58px', border: '1px solid ' + (typeFace === face ? '#4f46e5' : '#e3e7ee'), borderRadius: '12px', background: '#fff', cursor: 'pointer', fontFamily: `'${face}', cursive`, fontSize: '1.5rem', color: '#0f172a' }}
                      >
                        {typedName || signerName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ fontSize: '.71875rem', color: '#64748b', lineHeight: 1.6 }}>
                By selecting Adopt and sign, I agree this signature and initials are the electronic representation of my signature for all purposes.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setModal(null)} style={ghostBtn}>Cancel</button>
                <button type="button" onClick={adopt} disabled={pending} style={primaryBtn}>Adopt and sign</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'disclosure' ? (
        <div role="dialog" aria-modal="true" aria-label="Electronic Record and Signature Disclosure" style={overlay}>
          <div style={card('520px')}>
            <div style={cardHead}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>Electronic Record and Signature Disclosure</span>
                <span style={{ fontSize: '.75rem', color: '#64748b' }}>{'Consent v' + consentVersion + ' · accepted for ' + documentTitle}</span>
              </div>
              <button type="button" aria-label="Close" onClick={() => setModal(null)} style={iconBtn}>✕</button>
            </div>
            <div style={cardBody}>
              <div style={{ fontSize: '.78125rem', color: '#475569', lineHeight: 1.65, maxHeight: '240px', overflow: 'auto' }}>
                You have already consented to transact business electronically for this envelope. Your electronic signature has the same legal effect as a handwritten one, and every action you take is recorded in a tamper-evident audit trail with its own SHA-256 checksum. You may request a paper copy from the sender at any time, and you may withdraw consent for future envelopes by contacting them directly.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setModal(null)} style={ghostBtn}>Close</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'decline' ? (
        <div role="dialog" aria-modal="true" aria-label="Decline to sign" style={overlay}>
          <div style={card('520px')}>
            <div style={cardHead}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>Decline to sign</span>
                <span style={{ fontSize: '.75rem', color: '#64748b' }}>The sender is notified and the envelope closes for everyone</span>
              </div>
              <button type="button" aria-label="Close" onClick={() => setModal(null)} style={iconBtn}>✕</button>
            </div>
            <div style={cardBody}>
              <div style={{ fontSize: '.78125rem', color: '#475569', lineHeight: 1.65 }}>
                Declining stops this envelope permanently. Your reason is recorded in the audit trail and shared with the sender.
              </div>
              <textarea
                rows={3}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                aria-label="Reason"
                placeholder="Reason shared with the sender…"
                style={textareaStyle}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setModal(null)} style={ghostBtn}>Close</button>
                <button type="button" onClick={confirmDecline} disabled={pending} style={dangerBtn}>Decline to sign</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modal === 'reassign' ? (
        <div role="dialog" aria-modal="true" aria-label="Reassign this envelope" style={overlay}>
          <div style={card('520px')}>
            <div style={cardHead}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px' }}>Reassign this envelope</span>
                <span style={{ fontSize: '.75rem', color: '#64748b' }}>Your link is retired and a new invitation is emailed</span>
              </div>
              <button type="button" aria-label="Close" onClick={() => setModal(null)} style={iconBtn}>✕</button>
            </div>
            <div style={cardBody}>
              <input
                value={reassign.name}
                onChange={(e) => setReassign({ ...reassign, name: e.target.value })}
                aria-label="New signer name"
                placeholder="Full name"
                style={inputStyle}
              />
              <input
                value={reassign.email}
                onChange={(e) => setReassign({ ...reassign, email: e.target.value })}
                aria-label="New signer email"
                placeholder="name@company.com"
                style={inputStyle}
              />
              <textarea
                rows={3}
                value={reassign.reason}
                onChange={(e) => setReassign({ ...reassign, reason: e.target.value })}
                aria-label="Reason"
                placeholder="Why you are reassigning — shared with the sender…"
                style={textareaStyle}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button type="button" onClick={() => setModal(null)} style={ghostBtn}>Close</button>
                <button type="button" onClick={confirmReassign} disabled={pending} style={primaryBtn}>Reassign</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {s.toast ? (
        <div role="status" style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 90, background: '#0f172a', color: '#f1f5f9', padding: '11px 16px', borderRadius: '11px', fontSize: '.78125rem', boxShadow: '0 18px 40px -18px rgba(15,23,42,.6)', animation: 'sfIn .16s ease' }}>{s.toast}</div>
      ) : null}
    </>
  );
}
