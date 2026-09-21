'use client';
/**
 * The theme picker on the profile page: colour mode (light / dark / follow the
 * system) and accent palette. Every choice applies instantly through
 * ThemeProvider and is saved to the account by AppearanceSync, so the page
 * needs no Save button of its own.
 */
import type { CSSProperties } from 'react';
import Icon from '@/components/sf/Icon';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { MODE_LABELS, PALETTES, THEME_MODES, type ThemeMode } from '@/lib/theme/themes';
import { railHead, TEXT_MUTED } from '@/lib/sf/ui';

const MODE_ICONS: Record<ThemeMode, 'desktop' | 'sun' | 'moon'> = { system: 'desktop', light: 'sun', dark: 'moon' };

export default function AppearancePanel({ card }: { card: CSSProperties }) {
  const { appearance, resolved, setMode, setPalette } = useTheme();

  return (
    <div style={card} data-testid="appearance-panel">
      <div style={{ display:'flex', alignItems:'baseline', gap:'10px' }}>
        <span style={railHead}>Appearance</span>
        <span style={{ fontSize:'.71875rem', color: TEXT_MUTED, marginLeft:'auto' }}>
          Saved to your account · applies on every device you sign in on
        </span>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
        <span style={{ fontSize:'.75rem', fontWeight:600 }}>Colour mode</span>
        <div role="radiogroup" aria-label="Colour mode" style={{ display:'inline-flex', gap:'4px', padding:'3px', borderRadius:'10px', background:'hsl(var(--color-bg-muted))', alignSelf:'flex-start' }}>
          {THEME_MODES.map(mode => {
            const on = appearance.mode === mode;
            return (
              <button
                key={mode} type="button" role="radio" aria-checked={on} onClick={() => setMode(mode)}
                style={{ height:'30px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'.78125rem', fontWeight: on ? 600 : 500,
                  display:'inline-flex', alignItems:'center', gap:'6px',
                  background: on ? 'hsl(var(--color-bg-surface))' : 'transparent',
                  color: on ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))',
                  boxShadow: on ? 'var(--shadow-1)' : 'none' }}>
                <Icon name={MODE_ICONS[mode]} size={13} />{MODE_LABELS[mode]}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize:'.71875rem', color: TEXT_MUTED }}>
          {appearance.mode === 'system' ? `Following your system, currently ${resolved}.` : `Always ${resolved}, whatever your system prefers.`}
        </span>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
        <span style={{ fontSize:'.75rem', fontWeight:600 }}>Accent colour</span>
        <div role="radiogroup" aria-label="Accent colour" style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
          {PALETTES.map(p => {
            const on = appearance.palette === p.id;
            const swatch = resolved === 'dark' ? p.accentDark : p.accent;
            return (
              <button
                key={p.id} type="button" role="radio" aria-checked={on} aria-label={p.label} title={p.label}
                onClick={() => setPalette(p.id)}
                style={{ display:'inline-flex', alignItems:'center', gap:'8px', height:'34px', padding:'0 12px 0 8px', borderRadius:'99px', cursor:'pointer',
                  border:'1px solid ' + (on ? swatch : 'hsl(var(--color-border-subtle))'),
                  background: on ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))',
                  color: on ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-subtle))', fontSize:'.75rem', fontWeight: on ? 600 : 500 }}>
                <span aria-hidden="true" style={{ width:'18px', height:'18px', borderRadius:'99px', background: swatch, display:'grid', placeItems:'center', color:'#fff', flex:'0 0 18px' }}>
                  {on ? <Icon name="check" size={11} /> : null}
                </span>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
