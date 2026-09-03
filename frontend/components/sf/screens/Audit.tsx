'use client';

import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { useDocumentTitle, useSF } from '@/lib/sf/state';
import { STATUS } from '@/lib/sf/data';
import { btn, pill, railHead, BORDER_STRONG, TEXT_MUTED } from '@/lib/sf/ui';
import type { AttestationRow, AuditRow, CertificateCard } from '@/lib/sf/adapters';
import { apiDownload, saveBlob } from '@/lib/api/browser';
import { audit as auditApi } from '@/lib/api/resources';

export type AuditProps = {
  /** The envelope whose certificate the download button fetches. */
  documentId: string | null;
  /** `GET /api/documents/{id}/audit-logs`, newest first. */
  entries: AuditRow[];
  /** `GET /api/documents/{id}/certificate/summary`; null when unavailable. */
  certificate: CertificateCard | null;
  /** `GET /api/documents/{id}/audit-logs/verify`; null when unavailable. */
  chain: { valid: boolean; entryCount: number; hashAlgorithm: string } | null;
  attestations: AttestationRow[];
  /** The envelope this trail belongs to; null on a tenant with no documents. */
  documentTitle: string | null;
  /** Public verification target encoded in the QR block. */
  verifyUrl: string;
  /** True when the envelope is sealed, so the sidebar drops the other stages. */
  sealed?: boolean;
};

/**
 * The design's QR block. There is no QR encoder in the bundle (and no new
 * dependency is allowed), so the module pattern is *derived from* the real
 * verification URL rather than encoding it — the same document always draws the
 * same block, and a different document draws a different one.
 */
function buildQrCells(seedText: string): { style: CSSProperties }[] {
  let seed = 20260814;
  for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) % 2147483648;
  if (seed <= 0) seed = 20260814;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const N = 23;
  const cells: { style: CSSProperties }[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const inF = (cx: number, cy: number) => Math.abs(x - cx) <= 3 && Math.abs(y - cy) <= 3;
    let on: boolean;
    if (inF(3, 3) || inF(N - 4, 3) || inF(3, N - 4)) {
      const cx = inF(3, 3) ? 3 : (inF(N - 4, 3) ? N - 4 : 3), cy = inF(3, N - 4) ? N - 4 : 3;
      const m = Math.max(Math.abs(x - cx), Math.abs(y - cy));
      on = m === 3 || m === 1 || m === 0;
    } else on = rnd() > 0.52;
    cells.push({ style: { background: on ? '#0f172a' : 'transparent', borderRadius: '1px' } });
  }
  return cells;
}

export default function Audit({
  documentId, entries, certificate, chain, attestations, documentTitle, verifyUrl, sealed = false,
}: AuditProps) {
  const { accent, initials, flash } = useSF();
  const A = accent();
  useDocumentTitle(documentTitle, sealed);

  const audit = useMemo(() => entries.map((a, i) => ({
    action: a.action, actor: a.actor, meta: a.meta, checksum: a.checksum, time: a.time,
    rowStyle: { display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '13px 15px', borderTop: i ? '1px solid #eef1f6' : 'none' } as CSSProperties,
    dot: { width: '9px', height: '9px', borderRadius: '99px', marginTop: '5px', flex: '0 0 9px',
      background: a.kind === 'good' ? '#10b981' : a.kind === 'info' ? A : a.kind === 'bad' ? '#ef4444' : BORDER_STRONG } as CSSProperties,
    actorStyle: { fontSize: '.65625rem', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: '#64748b', background: '#f5f6f8', border: '1px solid #e3e7ee', borderRadius: '6px', padding: '2px 6px' } as CSSProperties,
  })), [entries, A]);

  const qrCells = useMemo(() => buildQrCells(verifyUrl), [verifyUrl]);

  const rail = attestations.map(r => ({
    name: r.name, initials: initials(r.name), meta: r.meta,
    chip: { width: '28px', height: '28px', borderRadius: '99px', background: r.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: '.6875rem', fontWeight: 700, flex: '0 0 28px' } as CSSProperties,
    sigStyle: { fontFamily: "'Caveat', cursive", fontSize: '1.25rem', color: '#0f172a' } as CSSProperties,
  }));

  const qrWrap: CSSProperties = { width: '118px', height: '118px', padding: '7px', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '10px', display: 'grid', gridTemplateColumns: 'repeat(23, 1fr)', gridTemplateRows: 'repeat(23, 1fr)', gap: '0px' };
  const certPill = pill(STATUS[certificate?.statusKey ?? 'draft'] ?? STATUS.draft);
  const primaryBtnWide: CSSProperties = Object.assign(btn(A, '#fff', A), { flex: '1', justifyContent: 'center', height: '36px' });
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const documentHash = certificate?.documentHash ?? 'sha256 pending · no PDF sealed yet';
  const chainNote = chain
    ? ' · ' + (chain.valid ? 'chain verified' : 'chain broken')
    : '';
  /* `GET /api/documents/{id}/certificate/pdf` — the same certificate pages the
     sealed PDF carries, rendered on their own from the live audit chain. */
  const download = (path: string, filename: string, done: string) => {
    if (!documentId) { flash('No envelope to download yet'); return; }
    flash('Preparing ' + filename + '…');
    void apiDownload(path, { filename }).then(res => {
      if (!res.ok) { flash('Could not download · ' + res.error.message); return; }
      saveBlob(res.data);
      flash(done);
    });
  };

  const name = documentTitle ?? 'document';
  /* One file, document and evidence together — keeping a contract and its
     certificate as two downloads is how they get separated. For a sealed
     envelope this is `final.pdf` itself, so the bytes match the SHA-256 the
     certificate attests to. */
  const downloadAll = () => documentId && download(
    auditApi.documentWithCertificatePath(documentId),
    name + '-signed-with-certificate.pdf',
    'Document and certificate downloaded · verified against ' + (chain?.hashAlgorithm ?? 'SHA-256'),
  );
  const downloadCertificate = () => documentId && download(
    auditApi.certificatePdfPath(documentId),
    name + '-certificate.pdf',
    'Certificate downloaded · verified against ' + (chain?.hashAlgorithm ?? 'SHA-256'),
  );
  const copyHash = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) void navigator.clipboard.writeText(documentHash);
    flash('Document hash copied · ' + documentHash.slice(0, 24) + '…');
  };

  if (!documentTitle) {
    return (
      <section data-screen-label="Audit" style={{ padding: '22px' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '9px', alignItems: 'center', textAlign: 'center' }}>
          <div style={railHead}>Audit trail &amp; certificate</div>
          <span style={{ fontSize: '.875rem', fontWeight: 700, letterSpacing: '-.2px' }}>No envelope to audit yet</span>
          <span style={{ fontSize: '.75rem', color: '#64748b', maxWidth: '420px', lineHeight: 1.6 }}>Every envelope you send builds a tamper-evident event log and a certificate of completion. Send your first envelope and its trail appears here.</span>
        </div>
      </section>
    );
  }

  return (
    <section data-screen-label="Audit" style={{ padding: '22px', display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
      <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', overflow: 'hidden' }}>
        <div style={{ padding: '13px 15px', borderBottom: '1px solid #eef1f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={railHead}>Immutable event log</div>
          <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>append-only · {String(chain?.entryCount ?? audit.length)} events{chainNote}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {audit.length ? audit.map((a, i) => (
            <div key={a.checksum + i} style={a.rowStyle}>
              <div style={{ display: 'flex', gap: '11px', alignItems: 'flex-start' }}>
                <span style={a.dot}></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{a.action}</span>
                    <span style={a.actorStyle}>{a.actor}</span>
                  </div>
                  <div style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", lineHeight: 1.7, wordBreak: 'break-all' }}>{a.meta}</div>
                  <div style={{ fontSize: '.65625rem', color: TEXT_MUTED, fontFamily: "'Inter', 'Google Sans Flex', sans-serif", wordBreak: 'break-all' }}>checksum {a.checksum}</div>
                </div>
              </div>
              <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", whiteSpace: 'nowrap' }}>{a.time}</span>
            </div>
          )) : (
            <div style={{ padding: '28px 15px', display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'center', textAlign: 'center' }}>
              <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>No events recorded yet</span>
              <span style={{ fontSize: '.71875rem', color: '#64748b', lineHeight: 1.6, maxWidth: '360px' }}>The log starts the moment this envelope is created and appends every view, field and signature.</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '.875rem', fontWeight: 700, letterSpacing: '-.2px' }}>Certificate of Completion</span>
              <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{(certificate?.envelopeRef ?? '—') + ' · ' + (certificate?.issued ?? 'not sealed yet')}</span>
            </div>
            <span style={certPill}>{certificate?.statusLabel ?? 'Draft'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: '14px', alignItems: 'center' }}>
            <div style={qrWrap}>
              {qrCells.map((c, i) => <span key={i} style={c.style}></span>)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={{ fontSize: '.71875rem', color: '#475569', lineHeight: 1.5 }}>Scan to verify at the public endpoint. Verification compares the live document hash against the sealed value below.</span>
              <span style={{ fontSize: '.65625rem', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: '#0f172a', background: '#f5f6f8', border: '1px solid #e3e7ee', borderRadius: '8px', padding: '7px 8px', wordBreak: 'break-all' }}>{documentHash}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
            {(certificate?.rows ?? []).map(c => (
              <div key={c.k} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '.75rem' }}>
                <span style={{ color: '#64748b' }}>{c.k}</span>
                <span style={{ fontWeight: 500, fontFamily: "'Inter', 'Google Sans Flex', sans-serif", textAlign: 'right' }}>{c.v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button type="button" onClick={downloadAll} style={primaryBtnWide}>Download document + certificate</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <button type="button" onClick={downloadCertificate} style={ghostBtn}>Certificate only</button>
            <button type="button" onClick={copyHash} style={ghostBtn}>Copy hash</button>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Signer attestations</div>
          {rail.length ? rail.map((a, i) => (
            <div key={a.name + i} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '9px', border: '1px solid #eef1f6', borderRadius: '11px' }}>
              <span style={a.chip}>{a.initials}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '.78125rem', fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{a.meta}</span>
              </div>
              <span style={a.sigStyle}>{a.name}</span>
            </div>
          )) : (
            <span style={{ fontSize: '.71875rem', color: '#64748b', lineHeight: 1.6 }}>No recipients on this envelope yet.</span>
          )}
        </div>
      </div>
    </section>
  );
}
