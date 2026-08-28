'use client';

import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { useSF } from '@/lib/sf/state';
import { AUDIT, CERT_ROWS, STATUS } from '@/lib/sf/data';
import { btn, pill, railHead } from '@/lib/sf/ui';

const DOC_HASH = 'sha256:9f2b7c41a0e58d3b6142cc70f8a9d5e21b4438ac0d7e61f95c2a8b3d4e6f7012';

function buildQrCells(): { style: CSSProperties }[] {
  let seed = 20260814;
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

export default function Audit() {
  const { accent, recips, initials, flash } = useSF();
  const A = accent();

  const audit = useMemo(() => AUDIT.map((a, i) => ({
    action: a.action, actor: a.actor, meta: a.meta, checksum: a.checksum, time: a.time,
    rowStyle: { display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '13px 15px', borderTop: i ? '1px solid #eef1f6' : 'none' } as CSSProperties,
    dot: { width: '9px', height: '9px', borderRadius: '99px', marginTop: '5px', flex: '0 0 9px',
      background: a.kind === 'good' ? '#10b981' : a.kind === 'info' ? A : '#cbd5e1' } as CSSProperties,
    actorStyle: { fontSize: '10.5px', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: '#64748b', background: '#f5f6f8', border: '1px solid #e3e7ee', borderRadius: '6px', padding: '2px 6px' } as CSSProperties,
  })), [A]);

  const qrCells = useMemo(buildQrCells, []);

  const attestations = recips().slice(0, 3).map(r => ({
    name: r.name, initials: initials(r.name),
    meta: r.email + ' · ' + (r.status === 'Viewed' ? '203.0.113.77 · Austin, US' : '198.51.100.24 · Seattle, US'),
    chip: { width: '28px', height: '28px', borderRadius: '99px', background: r.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 700, flex: '0 0 28px' } as CSSProperties,
    sigStyle: { fontFamily: "'Caveat', cursive", fontSize: '20px', color: '#0f172a' } as CSSProperties,
  }));

  const qrWrap: CSSProperties = { width: '118px', height: '118px', padding: '7px', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '10px', display: 'grid', gridTemplateColumns: 'repeat(23, 1fr)', gridTemplateRows: 'repeat(23, 1fr)', gap: '0px' };
  const certPill = pill(STATUS.completed);
  const primaryBtnWide: CSSProperties = Object.assign(btn(A, '#fff', A), { flex: '1', justifyContent: 'center', height: '36px' });
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const noop = () => flash('Certificate PDF generated · SHA-256 verified');

  return (
    <section data-screen-label="Audit" style={{ padding: '22px', display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
      <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', overflow: 'hidden' }}>
        <div style={{ padding: '13px 15px', borderBottom: '1px solid #eef1f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={railHead}>Immutable event log</div>
          <span style={{ fontSize: '11px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>append-only · {String(AUDIT.length)} events</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {audit.map((a, i) => (
            <div key={a.checksum + i} style={a.rowStyle}>
              <div style={{ display: 'flex', gap: '11px', alignItems: 'flex-start' }}>
                <span style={a.dot}></span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{a.action}</span>
                    <span style={a.actorStyle}>{a.actor}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", lineHeight: 1.7, wordBreak: 'break-all' }}>{a.meta}</div>
                  <div style={{ fontSize: '10.5px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", wordBreak: 'break-all' }}>checksum {a.checksum}</div>
                </div>
              </div>
              <span style={{ fontSize: '11px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", whiteSpace: 'nowrap' }}>{a.time}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, letterSpacing: '-.2px' }}>Certificate of Completion</span>
              <span style={{ fontSize: '11px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>ENV-2291-KD · issued 14 Aug 2026</span>
            </div>
            <span style={certPill}>Completed</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '118px 1fr', gap: '14px', alignItems: 'center' }}>
            <div style={qrWrap}>
              {qrCells.map((c, i) => <span key={i} style={c.style}></span>)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={{ fontSize: '11.5px', color: '#475569', lineHeight: 1.5 }}>Scan to verify at the public endpoint. Verification compares the live document hash against the sealed value below.</span>
              <span style={{ fontSize: '10.5px', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", color: '#0f172a', background: '#f5f6f8', border: '1px solid #e3e7ee', borderRadius: '8px', padding: '7px 8px', wordBreak: 'break-all' }}>{DOC_HASH}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
            {CERT_ROWS.map(c => (
              <div key={c.k} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '12px' }}>
                <span style={{ color: '#64748b' }}>{c.k}</span>
                <span style={{ fontWeight: 500, fontFamily: "'Inter', 'Google Sans Flex', sans-serif", textAlign: 'right' }}>{c.v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={noop} style={primaryBtnWide}>Download certificate</button>
            <button type="button" onClick={noop} style={ghostBtn}>Copy hash</button>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <div style={railHead}>Signer attestations</div>
          {attestations.map((a, i) => (
            <div key={a.name + i} style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '9px', border: '1px solid #eef1f6', borderRadius: '11px' }}>
              <span style={a.chip}>{a.initials}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{a.name}</span>
                <span style={{ fontSize: '11px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{a.meta}</span>
              </div>
              <span style={a.sigStyle}>{a.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
