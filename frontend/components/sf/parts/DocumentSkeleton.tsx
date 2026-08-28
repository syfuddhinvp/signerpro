import type { CSSProperties } from 'react';
import { SF_FONT } from '@/lib/sf/fallback';

/**
 * `loading.tsx` body for the document-scoped segments: the shell chrome and the
 * sidebar stay put while one envelope's data streams in.
 */
const bar = (w: string, h = '13px'): CSSProperties => ({
  width: w, height: h, borderRadius: '7px', background: '#e3e7ee',
  animation: 'sfPulse 1.4s ease-in-out infinite',
});
const panel: CSSProperties = {
  background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '17px',
  display: 'flex', flexDirection: 'column', gap: '13px',
};

export default function DocumentSkeleton({ label }: { label: string }) {
  return (
    <div style={{ padding: '22px', fontFamily: SF_FONT, display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <style>{'@keyframes sfPulse{0%,100%{opacity:.55}50%{opacity:1}}'}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        <div style={bar('220px', '19px')} />
        <div style={bar('300px', '11px')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
        <div style={panel}>{[0, 1, 2, 3, 4].map(i => <div key={i} style={bar(`${94 - i * 8}%`)} />)}</div>
        <div style={panel}>{[0, 1, 2].map(i => <div key={i} style={bar(`${88 - i * 11}%`)} />)}</div>
      </div>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{label}</span>
    </div>
  );
}
