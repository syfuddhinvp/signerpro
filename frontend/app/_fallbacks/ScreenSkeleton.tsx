import type { CSSProperties } from 'react';
import { SF_FONT } from '@/lib/sf/fallback';

/**
 * Segment-level loading skeleton.
 *
 * `app/(app)/loading.tsx` is a generic four-tile shape, which is wrong for
 * every screen that is not a dashboard: a table screen that flashes four stat
 * cards and then replaces them with rows reads as a layout change rather than
 * as loading. Each segment picks the shape it will actually become, and names
 * itself for screen readers.
 */
export type SkeletonShape = 'stats' | 'table' | 'split' | 'form';

const bar = (w: string, h = '13px'): CSSProperties => ({
  width: w, height: h, borderRadius: '7px', background: 'hsl(var(--color-border-subtle))',
  animation: 'sfPulse 1.4s ease-in-out infinite',
});

const panel: CSSProperties = {
  background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '16px', padding: '17px',
  display: 'flex', flexDirection: 'column', gap: '13px',
};

const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)',
};

export default function ScreenSkeleton({ label, shape = 'table' }: { label: string; shape?: SkeletonShape }) {
  return (
    <div
      style={{ padding: '26px 28px', fontFamily: SF_FONT, display: 'flex', flexDirection: 'column', gap: '18px' }}
      aria-busy="true"
      role="status"
    >
      <style>{'@keyframes sfPulse{0%,100%{opacity:.55}50%{opacity:1}}'}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
        <div style={bar('190px', '19px')} />
        <div style={bar('280px', '11px')} />
      </div>

      {shape === 'stats' || shape === 'split' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '13px' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ ...panel, gap: '11px' }}>
              <div style={bar('60%', '10px')} />
              <div style={bar('42%', '22px')} />
            </div>
          ))}
        </div>
      ) : null}

      {shape === 'split' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
          <div style={panel}>{[0, 1, 2, 3, 4].map(i => <div key={i} style={bar(`${94 - i * 8}%`)} />)}</div>
          <div style={panel}>{[0, 1, 2].map(i => <div key={i} style={bar(`${88 - i * 11}%`)} />)}</div>
        </div>
      ) : null}

      {shape === 'table' || shape === 'stats' ? (
        <div style={panel}>{[0, 1, 2, 3, 4, 5, 6].map(i => <div key={i} style={bar(`${94 - i * 6}%`)} />)}</div>
      ) : null}

      {shape === 'form' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '16px', alignItems: 'start' }}>
          <div style={panel}>{[0, 1, 2, 3].map(i => <div key={i} style={bar(i % 2 ? '72%' : '92%', '30px')} />)}</div>
          <div style={{ ...panel, background: 'hsl(var(--color-bg-panel-dark))', border: '1px solid hsl(var(--color-fg-default))' }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ ...bar(`${86 - i * 9}%`, '10px'), background: '#1e293b' }} />
            ))}
          </div>
        </div>
      ) : null}

      <span style={srOnly}>{label}</span>
    </div>
  );
}
