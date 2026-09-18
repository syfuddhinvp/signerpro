'use client';

/**
 * Choose which part of an image becomes the page.
 *
 * Adding a photographed page to a document brings the desk it was lying on
 * with it, and "fit" or "fill" can only ever scale the whole picture. This is
 * the third answer: drag a box over the part that matters and only that
 * reaches the PDF.
 *
 * The frame is either the shape of the document's own page or free. Locked
 * to the page, what the sender selects is exactly what lands on the sheet --
 * no white margins down the sides, and nothing trimmed off the selection to
 * make it fit. Free is there for the times the page shape is the wrong
 * question, so both are one click apart rather than one buried in the other.
 *
 * The box is kept in fractions of the image (0..1), which is what the API
 * takes — the preview is scaled to whatever fits on screen, and a rectangle
 * measured in preview pixels would mean something different at every window
 * size. Everything the pointer can do the keyboard can do too: the box is a
 * focusable control, arrows move it and shift+arrows resize it, because a
 * drag on a preview is exactly the kind of gesture that otherwise locks
 * somebody out of the feature entirely.
 */

import React from 'react';
import { btn, TEXT_MUTED } from '@/lib/sf/ui';
import Icon from '@/components/sf/Icon';

/** `x`, `y`, `width`, `height` as fractions of the image, from its top left. */
export type CropRect = { x: number; y: number; width: number; height: number };

export const WHOLE_IMAGE: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** A rectangle is only a crop if it actually leaves something out. */
export function isWholeImage(crop: CropRect): boolean {
  return crop.x <= 0.001 && crop.y <= 0.001 && crop.width >= 0.999 && crop.height >= 0.999;
}

export function cropToParam(crop: CropRect): string {
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return [round(crop.x), round(crop.y), round(crop.width), round(crop.height)].join(',');
}

const MIN_SIZE = 0.02;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
/** Which corner a handle drags; `move` is the body of the box. */
type Grip = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export type ImageCropDialogProps = {
  file: File;
  /** Width ÷ height of the page this image is joining, so the frame can be
   *  locked to it. Omitted, only the free frame is offered. */
  pageAspect?: number | null;
  /** Resolves with the chosen area, or `null` when the dialog is dismissed. */
  onDone: (crop: CropRect | null) => void;
};

export default function ImageCropDialog({ file, pageAspect, onDone }: ImageCropDialogProps) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [crop, setCrop] = React.useState<CropRect>(WHOLE_IMAGE);
  /** The image's own pixel size — a rectangle's shape on screen depends on it,
   *  and the crop is stored in fractions, which do not carry it. */
  const [pixels, setPixels] = React.useState<{ width: number; height: number } | null>(null);
  const [locked, setLocked] = React.useState(Boolean(pageAspect));
  /** Height fraction per unit of width fraction, for a box the page's shape. */
  const shape = React.useMemo(() => {
    if (!locked || !pageAspect || !pixels) return null;
    return pixels.width / (pixels.height * pageAspect);
  }, [locked, pageAspect, pixels]);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  /* An object URL is a handle on the file, not a copy of it — revoking it on
     the way out is what stops the bytes being held for the session. */
  React.useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  React.useEffect(() => { boxRef.current?.focus(); }, [url]);

  /* Switching the frame — or learning the image's size — re-cuts the box to
     the largest one of that shape, centred, rather than leaving a rectangle
     on screen that no longer matches the frame it says it is in. */
  React.useEffect(() => {
    setCrop(current => (shape === null ? current : largestOfShape(shape)));
  }, [shape]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  /** A pointer drag on the body or one of the corners. */
  const startDrag = (grip: Grip) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const frame = frameRef.current;
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) return;
    const origin = { x: e.clientX, y: e.clientY };
    const start = crop;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (move: PointerEvent) => {
      const dx = (move.clientX - origin.x) / bounds.width;
      const dy = (move.clientY - origin.y) / bounds.height;
      setCrop(grip === 'move' ? moveBy(start, dx, dy) : resizeBy(start, grip, dx, dy, shape));
    };
    const onUp = () => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  /** Arrows nudge the box; with shift they resize it from the bottom right. */
  const onBoxKeyDown = (e: React.KeyboardEvent) => {
    const step = e.altKey ? 0.01 : 0.05;
    const along: { [key: string]: [number, number] } = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    const delta = along[e.key];
    if (!delta) return;
    e.preventDefault();
    setCrop(current => (e.shiftKey
      ? resizeBy(current, 'se', delta[0], delta[1], shape)
      : moveBy(current, delta[0], delta[1])));
  };

  const percent = (n: number) => (n * 100).toFixed(4) + '%';
  const handleStyle = (corner: Grip): React.CSSProperties => ({
    position: 'absolute', width: '14px', height: '14px', background: '#fff', borderRadius: '3px',
    border: '1px solid #0f172a', touchAction: 'none',
    cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
    top: corner[0] === 'n' ? '-7px' : undefined, bottom: corner[0] === 's' ? '-7px' : undefined,
    left: corner[1] === 'w' ? '-7px' : undefined, right: corner[1] === 'e' ? '-7px' : undefined,
  });

  return (
    <div
      role="dialog" aria-modal="true" aria-labelledby={titleId}
      onClick={() => onDone(null)}
      style={{ position:'fixed', inset:0, zIndex:80, background:'rgba(15,23,42,.5)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:'14px', padding:'16px', maxWidth:'640px', width:'100%',
          display:'flex', flexDirection:'column', gap:'12px', boxShadow:'0 18px 48px rgba(15,23,42,.28)' }}>
        <div>
          <h2 id={titleId} style={{ margin:0, fontSize:'.9375rem', fontWeight:600 }}>Choose the area to keep</h2>
          <p style={{ margin:'4px 0 0', fontSize:'.75rem', color:TEXT_MUTED }}>
            Drag the box, or its corners, over the part of the image that should become the page.
            With the box focused, the arrow keys move it and shift + arrows resize it.
          </p>
        </div>

        {pageAspect ? (
          <div role="radiogroup" aria-label="Frame" style={{ display:'flex', gap:'6px' }}>
            {[
              { value: true, label: 'Page shape', hint: 'Fills the page exactly — no margins, nothing trimmed' },
              { value: false, label: 'Custom', hint: 'Any shape; what is left over becomes white margin' },
            ].map(option => (
              <button
                key={String(option.value)} type="button" role="radio" aria-checked={locked === option.value}
                title={option.hint} onClick={() => setLocked(option.value)}
                style={Object.assign({}, btn(locked === option.value ? '#0f172a' : '#fff',
                  locked === option.value ? '#fff' : '#475569',
                  locked === option.value ? '#0f172a' : '#e3e7ee'), { flex: 1, justifyContent: 'center' })}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        <div ref={frameRef} style={{ position:'relative', width:'100%', background:'#eceff4', borderRadius:'10px',
          overflow:'hidden', display:'flex', justifyContent:'center', userSelect:'none' }}>
          {url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={url} alt="" draggable={false}
              onLoad={e => setPixels({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              style={{ display:'block', maxWidth:'100%', maxHeight:'52vh', width:'auto', pointerEvents:'none' }} />
          ) : null}
          {/* Outside the box is dimmed, so the selection reads as the part
              that survives rather than as a decoration on top of it. */}
          <span aria-hidden="true" style={{ position:'absolute', inset:0, background:'rgba(15,23,42,.45)',
            clipPath:`polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${percent(crop.x)} ${percent(crop.y)}, ${percent(crop.x)} ${percent(crop.y + crop.height)}, ${percent(crop.x + crop.width)} ${percent(crop.y + crop.height)}, ${percent(crop.x + crop.width)} ${percent(crop.y)}, ${percent(crop.x)} ${percent(crop.y)})` }} />
          <div
            ref={boxRef} tabIndex={0} role="group" aria-label="Selected area"
            onPointerDown={startDrag('move')} onKeyDown={onBoxKeyDown}
            style={{ position:'absolute', touchAction:'none', cursor:'move', outlineOffset:'2px',
              left:percent(crop.x), top:percent(crop.y), width:percent(crop.width), height:percent(crop.height),
              border:'2px solid #fff', boxShadow:'0 0 0 1px rgba(15,23,42,.6)' }}
          >
            {(['nw','ne','sw','se'] as Grip[]).map(corner => (
              <span key={corner} onPointerDown={startDrag(corner)} style={handleStyle(corner)} />
            ))}
          </div>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'8px', justifyContent:'flex-end' }}>
          <span style={{ marginRight:'auto', fontSize:'.6875rem', color:TEXT_MUTED }}>
            Keeping {Math.round(crop.width * 100)}% × {Math.round(crop.height * 100)}% of the image
          </span>
          <button type="button" onClick={() => setCrop(shape === null ? WHOLE_IMAGE : largestOfShape(shape))}
            style={btn('#fff', '#475569', '#e3e7ee')}>
            <Icon name={shape === null ? 'image' : 'undo'} size={13} />{shape === null ? 'Whole image' : 'Reset'}
          </button>
          <button type="button" onClick={() => onDone(null)} style={btn('#fff', '#475569', '#e3e7ee')}><Icon name="close" size={13} />Cancel</button>
          <button type="button" onClick={() => onDone(crop)} style={btn('#0f172a', '#fff', '#0f172a')}>
            <Icon name="check" size={13} />Add this area
          </button>
        </div>
      </div>
    </div>
  );
}

/** Slide the box, stopping at the edges rather than shrinking against them. */
function moveBy(crop: CropRect, dx: number, dy: number): CropRect {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 1 - crop.width),
    y: clamp(crop.y + dy, 0, 1 - crop.height),
  };
}

/** The biggest box of a given shape, centred on the image. */
function largestOfShape(shape: number): CropRect {
  const width = Math.min(1, 1 / shape);
  const height = Math.min(1, shape);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/** Drag one corner; the opposite one stays put, and the box never inverts.
 *
 * With a `shape` the height follows the width, so the box keeps the page's
 * proportions however it is dragged; a corner that would take it off the
 * image is answered by deriving the width from the height instead, which
 * stops at the edge rather than silently changing the shape. */
function resizeBy(crop: CropRect, grip: Grip, dx: number, dy: number, shape: number | null = null): CropRect {
  const left = crop.x;
  const top = crop.y;
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  const west = grip === 'nw' || grip === 'sw';
  const north = grip === 'nw' || grip === 'ne';
  const nextLeft = west ? clamp(left + dx, 0, right - MIN_SIZE) : left;
  const nextRight = west ? right : clamp(right + dx, left + MIN_SIZE, 1);
  const nextTop = north ? clamp(top + dy, 0, bottom - MIN_SIZE) : top;
  const nextBottom = north ? bottom : clamp(bottom + dy, top + MIN_SIZE, 1);
  const free = { x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop };
  if (shape === null) return free;

  const room = north ? nextBottom : 1 - nextTop;
  const width = Math.min(free.width, room / shape, west ? nextRight : 1 - nextLeft);
  const height = width * shape;
  return {
    x: west ? nextRight - width : nextLeft,
    y: north ? nextBottom - height : nextTop,
    width: Math.max(width, MIN_SIZE),
    height: Math.max(height, MIN_SIZE * shape),
  };
}
