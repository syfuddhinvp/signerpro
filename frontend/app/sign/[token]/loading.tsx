/** Skeleton for the signing session while the token is being resolved. */
import { SF_FONT } from '@/lib/sf/fallback';

export default function SignLoading() {
  const bar = (w: string, h = '13px') => ({
    width: w, height: h, borderRadius: '7px', background: '#e3e7ee',
    animation: 'sfPulse 1.4s ease-in-out infinite',
  } as const);

  return (
    <div style={{ flex: 1, minHeight: 0, fontFamily: SF_FONT, display: 'flex', flexDirection: 'column' }}>
      <style>{'@keyframes sfPulse{0%,100%{opacity:.55}50%{opacity:1}}'}</style>
      <div style={{ flex: '0 0 auto', background: '#fff', borderBottom: '1px solid #e3e7ee', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
          <div style={bar('220px', '12px')} />
          <div style={{ height: '6px', borderRadius: '99px', background: '#eef1f6', maxWidth: '420px' }} />
        </div>
        <div style={bar('130px', '32px')} />
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: '24px', display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '816px', maxWidth: '100%', height: '520px', background: '#fff', borderRadius: '3px', boxShadow: '0 24px 60px -24px rgba(15,23,42,.35), 0 0 0 1px #dfe4ec', padding: '64px 72px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div style={bar('42%', '10px')} />
          <div style={bar('26%', '22px')} />
          {[0, 1, 2, 3, 4].map(i => <div key={i} style={bar(`${94 - i * 6}%`, '11px')} />)}
        </div>
      </div>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading your envelope</span>
    </div>
  );
}
