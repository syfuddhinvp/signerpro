/**
 * Page annotations — the sender's own marks on the document: a freehand pen
 * drawing and a text box in a chosen face and size.
 *
 * This is the client half of `backend/app/core/annotations.py`; the shape below
 * is the same one the API normalises and the final PDF draws, so the two must
 * be changed together. Both are stored as ordinary fields of type `drawing` /
 * `textbox`, always read-only and never required: they place no obligation on a
 * recipient, they are simply drawn.
 *
 * Stroke points are normalised to the field's own box (0..1, top-left origin),
 * which is why a drawing survives being dragged, resized, or drawn at one zoom
 * level and rendered at another — the mark is defined relative to its box, not
 * to the page.
 */

export const ANNOTATION_TYPES = ['drawing', 'textbox'] as const;
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];

export function isAnnotationType(type: string): type is AnnotationType {
  return type === 'drawing' || type === 'textbox';
}

/** The three base-14 families the PDF can draw without an embedded font. */
export const TEXTBOX_FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'helvetica', label: 'Helvetica (sans-serif)', stack: 'Helvetica, Arial, var(--font-sans), sans-serif' },
  { id: 'times', label: 'Times (serif)', stack: '"Times New Roman", Times, Georgia, serif' },
  { id: 'courier', label: 'Courier (monospace)', stack: '"Courier New", Courier, var(--font-geist-mono), monospace' },
];
export const TEXTBOX_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
export const DEFAULT_TEXTBOX_FONT = 'helvetica';
export const DEFAULT_TEXTBOX_SIZE = 12;
export const MIN_TEXTBOX_SIZE = 6;
export const MAX_TEXTBOX_SIZE = 96;
export const DEFAULT_INK = '#0f172a';
export const INK_COLORS = ['#0f172a', '#1d4ed8', '#dc2626', '#047857', '#b45309'];
export const MIN_PEN_WIDTH = 0.5;
export const MAX_PEN_WIDTH = 12;
export const DEFAULT_PEN_WIDTH = 2;

export type TextboxOptions = {
  kind: 'textbox';
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
};

/** One stroke is a list of `[x, y]` pairs, each 0..1 within the field box. */
export type Stroke = [number, number][];

export type DrawingOptions = {
  kind: 'drawing';
  color: string;
  stroke: number;
  strokes: Stroke[];
};

type Raw = Record<string, unknown> | unknown[] | null | undefined;

function asRecord(options: Raw): Record<string, unknown> {
  return options && !Array.isArray(options) && typeof options === 'object'
    ? (options as Record<string, unknown>)
    : {};
}

function color(value: unknown, fallback = DEFAULT_INK): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

function clamp(value: unknown, low: number, high: number, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(low, Math.min(high, n));
}

export function textboxOptions(options: Raw): TextboxOptions {
  const raw = asRecord(options);
  const font = typeof raw.font === 'string' ? raw.font.toLowerCase() : '';
  return {
    kind: 'textbox',
    font: TEXTBOX_FONTS.some(f => f.id === font) ? font : DEFAULT_TEXTBOX_FONT,
    size: Math.round(clamp(raw.size, MIN_TEXTBOX_SIZE, MAX_TEXTBOX_SIZE, DEFAULT_TEXTBOX_SIZE) * 100) / 100,
    bold: raw.bold === true,
    italic: raw.italic === true,
    color: color(raw.color),
  };
}

export function drawingOptions(options: Raw): DrawingOptions {
  const raw = asRecord(options);
  const source = Array.isArray(raw.strokes) ? raw.strokes : [];
  const strokes: Stroke[] = [];
  for (const entry of source) {
    if (!Array.isArray(entry)) continue;
    const points: Stroke = [];
    for (const point of entry) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const x = clamp(point[0], 0, 1, NaN);
      const y = clamp(point[1], 0, 1, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push([x, y]);
    }
    if (points.length) strokes.push(points);
  }
  return {
    kind: 'drawing',
    color: color(raw.color),
    stroke: clamp(raw.stroke, MIN_PEN_WIDTH, MAX_PEN_WIDTH, DEFAULT_PEN_WIDTH),
    strokes,
  };
}

/** The CSS `font-family` for a stored family id. */
export function textboxFontStack(font: string): string {
  const entry = TEXTBOX_FONTS.find(f => f.id === (font || '').toLowerCase());
  return (entry ?? TEXTBOX_FONTS[0]).stack;
}

/**
 * One stroke as an SVG `d`, scaled into a box `w` × `h` (CSS px). A one-point
 * stroke is a tap: it is drawn as a zero-length line, which a round linecap
 * renders as the dot the sender made.
 */
export function strokePath(stroke: Stroke, w: number, h: number): string {
  if (!stroke.length) return '';
  const at = (p: [number, number]) => (p[0] * w).toFixed(2) + ' ' + (p[1] * h).toFixed(2);
  if (stroke.length === 1) return 'M' + at(stroke[0]) + 'L' + at(stroke[0]);
  return 'M' + at(stroke[0]) + stroke.slice(1).map(p => 'L' + at(p)).join('');
}

/**
 * The bounding box of a freehand gesture, in page points, padded so a stroke
 * drawn with a thick nib is not clipped by its own box — and never thinner than
 * a couple of points, so a straight horizontal line still has a box to live in.
 */
export function strokeBounds(points: [number, number][], pad: number) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
  const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
  return { x, y, w: Math.max(w, 2), h: Math.max(h, 2) };
}

/** Page-point gesture → the normalised payload the API and the PDF read. */
export function toDrawingOptions(
  points: [number, number][],
  box: { x: number; y: number; w: number; h: number },
  style: { color: string; stroke: number },
): DrawingOptions {
  const round = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000;
  return {
    kind: 'drawing',
    color: color(style.color),
    stroke: clamp(style.stroke, MIN_PEN_WIDTH, MAX_PEN_WIDTH, DEFAULT_PEN_WIDTH),
    strokes: [points.map(([px, py]) => [round((px - box.x) / box.w), round((py - box.y) / box.h)] as [number, number])],
  };
}
