'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { btn, pill, inputStyle, lbl, railHead, TONE_NEUTRAL } from '@/lib/sf/ui';

export default function Routing() {
  const { s, set, accent, recips, reorder } = useSF();
  const A = accent();

  const list = recips();

  const routingRows = list.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    order: s.routing === 'parallel' ? '=' : String(r.order),
    status: r.status,
    rowStyle: { display: 'flex', alignItems: 'center', gap: '11px', padding: '11px', border: '1px solid #eef1f6', borderRadius: '12px', background: '#fbfcfd' } as CSSProperties,
    orderStyle: { width: '26px', height: '26px', borderRadius: '8px', background: r.color, color: '#fff', display: 'grid', placeItems: 'center', fontSize: '11.5px', fontWeight: 700, flex: '0 0 26px' } as CSSProperties,
    selectStyle: Object.assign({}, inputStyle, { width: '160px' }) as CSSProperties,
    pill: pill(TONE_NEUTRAL),
    onRole: (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      set({ recipients: list.map(x => (x.id === r.id ? Object.assign({}, x, { role: v }) : x)) });
    },
    onUp: () => reorder(r.id, -1),
    onDown: () => reorder(r.id, 1)
  }));

  const cadences = ['24h', '48h', '7 days', 'none'].map(c => ({
    key: c,
    label: c === 'none' ? 'No reminders' : 'Every ' + c,
    onClick: () => set({ cadence: c }),
    style: btn(s.cadence === c ? '#eef2ff' : '#fff', s.cadence === c ? '#3730a3' : '#475569', s.cadence === c ? '#c7d2fe' : '#e3e7ee')
  }));

  const timeline = ([
    ['Envelope queued', 'now · sequential · ' + list.length + ' recipients'],
    ['Signer 1 notified', '+0s · alex.rivera@acme.io'],
    ['Reminder scheduled', s.cadence === 'none' ? 'disabled' : '+' + s.cadence + ' cadence'],
    ['Expires', 'in ' + s.expiry + ' days · auto-void']
  ] as [string, string][]).map(([label, meta], i) => ({
    label, meta,
    dot: { width: '8px', height: '8px', borderRadius: '99px', marginTop: '5px', flex: '0 0 8px', background: i === 0 ? '#10b981' : '#334155' } as CSSProperties
  }));

  const seqStyle: CSSProperties = { height: '28px', padding: '0 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: s.routing === 'sequential' ? 600 : 500, background: s.routing === 'sequential' ? '#fff' : 'transparent', color: s.routing === 'sequential' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'sequential' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const parStyle: CSSProperties = { height: '28px', padding: '0 12px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12.5px', fontWeight: s.routing === 'parallel' ? 600 : 500, background: s.routing === 'parallel' ? '#fff' : 'transparent', color: s.routing === 'parallel' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'parallel' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const routeNote = s.routing === 'sequential'
    ? 'Each recipient is notified only after the previous one completes. Signer 1 → Signer 2 → Signer 3.'
    : 'All recipients are notified simultaneously and may sign in any order.';
  const routeNoteStyle: CSSProperties = { fontSize: '12px', color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: '10px', padding: '10px 11px', lineHeight: 1.55 };
  const iconBtn: CSSProperties = { width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee', background: '#fff', cursor: 'pointer', color: '#475569', fontSize: '13px', lineHeight: 1 };
  const textarea: CSSProperties = { border: '1px solid #e3e7ee', borderRadius: '9px', padding: '8px 10px', fontSize: '12.5px', resize: 'vertical', outline: 'none', width: '100%', color: '#0f172a' };
  const primaryBtnWide: CSSProperties = Object.assign(btn(A, '#fff', A), { flex: '1', justifyContent: 'center', height: '36px' });

  return (
    <section data-screen-label="Routing" style={{ padding: '22px', display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
      <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={railHead}>Signing order</div>
          <div style={{ display: 'flex', gap: '4px', background: '#f5f6f8', padding: '4px', borderRadius: '10px' }}>
            <button type="button" onClick={() => set({ routing: 'sequential' })} style={seqStyle}>Sequential</button>
            <button type="button" onClick={() => set({ routing: 'parallel' })} style={parStyle}>Parallel</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
          {routingRows.map(r => (
            <div key={r.id} style={r.rowStyle}>
              <span style={r.orderStyle}>{r.order}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{r.name}</span>
                <span style={{ fontSize: '11.5px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{r.email}</span>
              </div>
              <select value={r.role} onChange={r.onRole} aria-label="Role" style={r.selectStyle}>
                <option value="sign">Needs to sign</option>
                <option value="inperson">In-person signer</option>
                <option value="copy">Receives a copy</option>
                <option value="approve">Approver</option>
              </select>
              <span style={r.pill}>{r.status}</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button type="button" aria-label="Move up" onClick={r.onUp} style={iconBtn}>↑</button>
                <button type="button" aria-label="Move down" onClick={r.onDown} style={iconBtn}>↓</button>
              </div>
            </div>
          ))}
        </div>
        <div style={routeNoteStyle}>{routeNote}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={railHead}>Reminders &amp; expiration</div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {cadences.map(c => (
              <button key={c.key} type="button" onClick={c.onClick} style={c.style}>{c.label}</button>
            ))}
          </div>
          <label style={lbl}>Expires after
            <select value={s.expiry} onChange={(e) => set({ expiry: e.target.value })} style={inputStyle}>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <label style={lbl}>Email message
            <textarea onChange={(e) => set({ message: e.target.value })} value={s.message} rows={4} style={textarea} />
          </label>
          <button type="button" onClick={() => set({ screen: 'sign' })} style={primaryBtnWide}>Send envelope &amp; preview signer view</button>
        </div>
        <div style={{ background: '#0f172a', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '11px', letterSpacing: '.08em', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>DELIVERY SIMULATION</div>
          {timeline.map(t => (
            <div key={t.label} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
              <span style={t.dot}></span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontSize: '12.5px', color: '#e2e8f0', fontWeight: 500 }}>{t.label}</span>
                <span style={{ fontSize: '11px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{t.meta}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
