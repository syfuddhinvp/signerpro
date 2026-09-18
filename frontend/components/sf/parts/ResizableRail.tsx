'use client';
/* A builder side rail that the sender can widen, narrow or fold away.

   The prepare screen puts three panes on one row — palette, canvas, inspector —
   and the two rails were fixed-width, so a long recipient name or a field label
   truncated with no way to see the rest, and a small laptop screen gave the PDF
   whatever was left over. The width lives in localStorage per rail, so the size
   somebody picks survives navigation and reloads. */
import React, { type CSSProperties } from 'react';
import Icon from '@/components/sf/Icon';

const HANDLE = 6;

export type ResizableRailProps = {
  /** Which edge of the row the rail sits on — decides which side the drag handle
   *  is on and which way a positive pointer delta grows the rail. */
  side: 'left' | 'right';
  /** localStorage key holding `{ width, collapsed }` for this rail. */
  storageKey: string;
  /** Names the rail for the collapse control and the folded strip. */
  label: string;
  defaultWidth: number;
  min?: number;
  max?: number;
  children: React.ReactNode;
  /** Applied to the scrolling content box, not the outer frame. */
  contentStyle?: CSSProperties;
};

type Stored = { width: number; collapsed: boolean };

function readStored(key: string): Stored | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.width !== 'number' || !Number.isFinite(parsed.width)) return null;
    return { width: parsed.width, collapsed: parsed.collapsed === true };
  } catch {
    /* Private mode, a disabled store or a value another version wrote: the rail
       simply opens at its default rather than failing to render. */
    return null;
  }
}

export default function ResizableRail({
  side, storageKey, label, defaultWidth, min = 220, max = 560, children, contentStyle,
}: ResizableRailProps) {
  const clamp = React.useCallback((n: number) => Math.min(max, Math.max(min, Math.round(n))), [min, max]);
  const [width, setWidth] = React.useState(defaultWidth);
  const [collapsed, setCollapsed] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);

  /* Read after mount: the server has no localStorage, so restoring during render
     would hydrate a different width than the markup it sent. */
  React.useEffect(() => {
    const stored = readStored(storageKey);
    if (!stored) return;
    setWidth(clamp(stored.width));
    setCollapsed(stored.collapsed);
  }, [storageKey, clamp]);

  const persist = React.useCallback((next: Stored) => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* Nothing to do — the rail still works for this session. */
    }
  }, [storageKey]);

  const drag = React.useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed || e.button !== 0) return;
    drag.current = { startX: e.clientX, startWidth: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = e.clientX - d.startX;
    setWidth(clamp(d.startWidth + (side === 'left' ? delta : -delta)));
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    persist({ width, collapsed });
  };

  /* The separator is focusable and takes the arrow keys, so the rail is
     resizable without a pointer (a drag handle alone is mouse-only). */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    let next = width;
    if (e.key === 'ArrowLeft') next = clamp(width - step);
    else if (e.key === 'ArrowRight') next = clamp(width + step);
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); return; }
    else return;
    e.preventDefault();
    setWidth(next);
    persist({ width: next, collapsed });
  };

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    persist({ width, collapsed: next });
  };

  const border = side === 'left' ? { borderRight: '1px solid #e3e7ee' } : { borderLeft: '1px solid #e3e7ee' };
  const chevron = <Icon name={(side === 'left') === collapsed ? 'chevronRight' : 'chevronLeft'} size={13} />;

  if (collapsed) {
    return (
      <div style={{ flex: '0 0 34px', width: '34px', background: '#fff', ...border, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '10px 0' }}>
        <button
          type="button" onClick={toggle} title={'Show ' + label} aria-label={'Show ' + label} aria-expanded={false}
          style={{ width: '24px', height: '24px', borderRadius: '7px', border: '1px solid #e3e7ee', background: '#fff', color: '#475569', cursor: 'pointer', fontSize: '.8125rem', lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >{chevron}</button>
        <span aria-hidden="true" style={{ writingMode: 'vertical-rl', fontSize: '.6875rem', color: '#64748b', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
    );
  }

  const handle = (
    <div
      role="separator" tabIndex={0} aria-orientation="vertical" aria-label={'Resize ' + label}
      aria-valuenow={width} aria-valuemin={min} aria-valuemax={max}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => { setWidth(defaultWidth); persist({ width: defaultWidth, collapsed }); }}
      title={'Drag to resize ' + label + ' — double-click to reset'}
      style={{
        flex: '0 0 ' + HANDLE + 'px', width: HANDLE + 'px', cursor: 'col-resize', background: dragging ? '#c7d2fe' : 'transparent',
        outlineOffset: '-2px', touchAction: 'none',
      }}
    />
  );

  return (
    <div style={{ flex: '0 0 ' + (width + HANDLE) + 'px', width: (width + HANDLE) + 'px', display: 'flex', background: '#fff', ...border, minHeight: 0, position: 'relative' }}>
      {/* Anchored to the frame rather than the scrolling content, so folding the
          rail away stays one click from anywhere in a long inspector. */}
      <button
        type="button" onClick={toggle} title={'Hide ' + label} aria-label={'Hide ' + label} aria-expanded={true}
        style={{
          position: 'absolute', top: '8px', right: (side === 'left' ? HANDLE + 8 : 8) + 'px', zIndex: 2,
          width: '22px', height: '22px', borderRadius: '7px', border: '1px solid #e3e7ee', background: '#fff',
          color: '#475569', cursor: 'pointer', fontSize: '.8125rem', lineHeight: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}
      >{chevron}</button>
      {side === 'right' ? handle : null}
      <div data-sf-scroll="1" style={{ flex: 1, minWidth: 0, overflow: 'auto', ...contentStyle }}>
        {children}
      </div>
      {side === 'left' ? handle : null}
    </div>
  );
}
