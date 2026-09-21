import { SF_FONT } from '@/lib/sf/fallback';

/** Skeleton shown while an in-app route streams in — Shell chrome stays put. */
export default function AppLoading() {
  const bar = (w: string, h = '13px') => ({
    width: w, height: h, borderRadius: '7px', background: 'hsl(var(--color-border-subtle))',
    animation: 'sfPulse 1.4s ease-in-out infinite',
  } as const);

  return (
    <div style={{ padding: '26px 28px', fontFamily: SF_FONT, display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <style>{'@keyframes sfPulse{0%,100%{opacity:.55}50%{opacity:1}}'}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        <div style={bar('190px', '19px')} />
        <div style={bar('280px', '11px')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '13px' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '13px', padding: '17px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
            <div style={bar('60%', '10px')} />
            <div style={bar('42%', '22px')} />
          </div>
        ))}
      </div>
      <div style={{ background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '13px', padding: '17px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={bar(`${92 - i * 7}%`)} />)}
      </div>
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Loading</span>
    </div>
  );
}
