'use client';

import type { CSSProperties } from 'react';
import { useSF, logsScoped } from '@/lib/sf/state';
import { LOG_SOURCES, LOG_LEVELS, LEVEL_TONE } from '@/lib/sf/data';

export default function Logs() {
  const { s, set, isPlat: isPlatFn, logsFiltered } = useSF();
  const isPlat = isPlatFn();

  const logScoped = logsScoped(isPlat);
  const logRows = logsFiltered();

  const chipStyle = (on: boolean): CSSProperties => ({
    height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: on ? 600 : 500,
    background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none'
  });

  const logSources = LOG_SOURCES
    .filter(([id]) => isPlat || (id !== 'admin'))
    .map(([id, label]) => {
      const on = s.logSource === id;
      return { id, label, selected: (on ? 'true' : 'false') as 'true' | 'false', onClick: () => set({ logSource: id }), style: chipStyle(on) };
    });

  const logLevels = LOG_LEVELS.map(([id, label]) => {
    const on = s.logLevel === id;
    return { id, label, selected: (on ? 'true' : 'false') as 'true' | 'false', onClick: () => set({ logLevel: id }), style: chipStyle(on) };
  });

  const logs = logRows.map((l, i) => {
    const open = s.openLog === l.ts;
    const tone = LEVEL_TONE[l.level];
    return {
      key: l.ts + '-' + i,
      ts: l.ts, level: l.level.toUpperCase(), source: l.source, msg: l.msg, code: l.code, latency: l.latency, payload: l.payload,
      open, openStr: (open ? 'true' : 'false') as 'true' | 'false',
      onToggle: () => set({ openLog: open ? null : l.ts }),
      wrapStyle: { borderTop: i ? '1px solid #1a2740' : 'none', background: open ? '#0b1424' : 'transparent' } as CSSProperties,
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', width:'100%', padding:'9px 15px', background:'transparent', border:'none', cursor:'pointer' } as CSSProperties,
      levelStyle: { padding:'2px 7px', borderRadius:'6px', background: tone.bg, color: tone.fg, fontSize:'9.5px', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' } as CSSProperties,
      srcStyle: { fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", width:'62px', flex:'0 0 62px', textAlign:'left' } as CSSProperties,
      codeStyle: { fontSize:'10.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto', width:'34px', textAlign:'right',
        color: l.code === '429' || l.code === '402' || l.code === '422' || l.code === '502' ? '#fda4af' : '#64748b' } as CSSProperties
    };
  });

  const logCountLabel = logs.length + ' of ' + logScoped.length + ' events';
  const logScopeLabel = isPlat ? 'scope: all tenants' : 'scope: acme';

  return (
    <section data-screen-label="Logs" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'14px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'10px' }}>
          {logSources.map(l => (
            <button key={l.id} type="button" onClick={l.onClick} aria-pressed={l.selected} style={l.style}>{l.label}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'10px' }}>
          {logLevels.map(l => (
            <button key={l.id} type="button" onClick={l.onClick} aria-pressed={l.selected} style={l.style}>{l.label}</button>
          ))}
        </div>
        <input type="search" value={s.logQuery} onChange={(e) => set({ logQuery: e.target.value })} placeholder="Search message, request id, actor…" aria-label="Search logs"
          style={{ height:'32px', flex:1, minWidth:'200px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'12.5px', outline:'none', background:'#fff' }} />
        <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' }}>{logCountLabel}</span>
      </div>

      <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:'16px', overflow:'hidden' }}>
        {logs.map(l => (
          <div key={l.key} style={l.wrapStyle}>
            <button type="button" onClick={l.onToggle} aria-expanded={l.openStr} style={l.rowStyle}>
              <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto' }}>{l.ts}</span>
              <span style={l.levelStyle}>{l.level}</span>
              <span style={l.srcStyle}>{l.source}</span>
              <span style={{ fontSize:'12px', color:'#e2e8f0', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textAlign:'left' }}>{l.msg}</span>
              <span style={l.codeStyle}>{l.code}</span>
              <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 auto', width:'56px', textAlign:'right' }}>{l.latency}</span>
            </button>
            {l.open ? (
              <pre style={{ margin:0, padding:'12px 16px 16px 16px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11px', color:'#a5b4fc', background:'#0b1424', whiteSpace:'pre-wrap', wordBreak:'break-all', lineHeight:1.65 }}>{l.payload}</pre>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>
        <span>retention 90 days · streamed to S3 + Datadog</span>
        <span>{logScopeLabel}</span>
      </div>
    </section>
  );
}
