'use client';
/* SignerPro builder pointer/keyboard machinery — ported from the prototype app.js
   (onToolDown / onFieldDown / onResizeDown / onSheetDown / onMove / onUp / onKey,
    deleteSel / duplicateSel / alignLeft / alignCenterX / distribute). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSF, type SFField, type SFState } from './state';
import { useNav } from './nav';
import { TYPES } from './data';
import {
  DEFAULT_TEXTBOX_FONT, DEFAULT_TEXTBOX_SIZE, strokeBounds, toDrawingOptions,
} from './annotations';
import { newRadioGroupFields, RADIO_MIN_SIZE, RADIO_PITCH, RADIO_SIZE } from './radioGroups';

type Drag =
  | {
      mode: 'move'; ids: string[]; sx: number; sy: number;
      orig: { id: string; x: number; y: number; page: number }[];
      /* Where inside the anchor field the pointer grabbed it, in page points.
         Carrying the grab point lets the field land under the cursor when the
         gesture crosses onto a different page, where a plain client-space
         delta would mean nothing. */
      grabX: number; grabY: number;
    }
  | { mode: 'resize'; ids: string[]; sx: number; sy: number; orig: { id: string; w: number; h: number }[] }
  | { mode: 'lasso'; x0: number; y0: number; page: number }
  /* ANN-1 — a freehand gesture in flight. Points are collected in page points
     and only normalised against the stroke's own bounding box on release, when
     that box is finally known. */
  | { mode: 'pen'; page: number; points: [number, number][] };

const metaOf = (t: string) => TYPES.find(x => x.id === t) || TYPES[0];
const snapWith = (grid: boolean, v: number) => (grid ? Math.round(v / 8) * 8 : Math.round(v));

/**
 * `documentId` only steers navigation: dragging a tool while some other screen
 * is showing jumps to the builder, and the builder is a per-document route, so
 * the gesture has to name the envelope it belongs to. Omitted, the document
 * already in the URL is carried over.
 */
export type BuilderInteractionsInput = {
  documentId?: string | null;
  /**
   * The current page's true size in PDF points, from the rendered document.
   * Used to place a keyboard-created field in the middle of the *real* page
   * rather than of an assumed US-Letter sheet.
   */
  pageSize?: { width: number; height: number } | null;
  /**
   * Every page's true size in PDF points, indexed by page number − 1. The
   * canvas renders the whole document as one scrolling column, so a gesture can
   * land on any page — each one is clamped against its own size rather than
   * against whichever page happens to be active.
   */
  pageSizes?: { width: number; height: number }[];
  /**
   * The document's own page count. `pageSizes` only covers the pages the viewer
   * has measured, so an action that spans the whole document — copying a field
   * to every page — asks this instead of counting rendered pages.
   */
  pageCount?: number;
  /**
   * Store the parts of a newly created field that `SFField` has no room for —
   * `useDocumentPersistence.setFieldExtras`. Placing an annotation is the one
   * gesture that authors a payload (the strokes, or the text box's face and
   * size) at the moment the field is created, so it has to reach the extras
   * record the bulk save reads from. Omitted, annotations cannot be placed.
   */
  setFieldExtras?: (fieldId: string, patch: AnnotationExtras) => void;
  /**
   * Read a field's extras — `useDocumentPersistence.fieldExtras`. A copy of a
   * field has to carry them: a duplicated radio button whose `options` were
   * left behind is not a button at all (it loses the group it belongs to), and
   * a duplicated dropdown used to lose its choices the same way.
   */
  getFieldExtras?: (fieldId: string) => Pick<FieldExtrasSlice, 'apiType' | 'options'> | null;
};

/** Alias for the extras record defined with the persistence hook below. */
type FieldExtrasSlice = import('./adapters').BuilderFieldExtras;

/** The slice of `BuilderFieldExtras` an annotation placement writes. */
export type AnnotationExtras = {
  apiType: FieldExtrasSlice['apiType'];
  options: Record<string, unknown>;
  defaultValue?: string | null;
};

/** A newly placed annotation's payload, or null for an ordinary field. */
function newAnnotationExtras(typeId: string): AnnotationExtras | null {
  if (typeId === 'textbox') {
    return {
      apiType: 'textbox',
      options: {
        kind: 'textbox', font: DEFAULT_TEXTBOX_FONT, size: DEFAULT_TEXTBOX_SIZE,
        bold: false, italic: false, color: 'hsl(var(--color-fg-default))',
      },
      defaultValue: '',
    };
  }
  if (typeId === 'drawing') {
    return { apiType: 'drawing', options: { kind: 'drawing', color: 'hsl(var(--color-fg-default))', stroke: 2, strokes: [] } };
  }
  return null;
}

/**
 * A radio group is placed as a set of fields, one per button (see
 * `lib/sf/radioGroups.ts`), so the sender can then drag each button to the
 * paragraph it answers. Every other type places exactly one field, which is
 * why the two placement paths below branch here rather than everywhere.
 */
function placeRadioGroup(seed: {
  page: number; x: number; y: number; to: string; maxY?: number;
}): { fields: SFField[]; options: Record<string, Record<string, unknown>> } {
  const stamp = Date.now();
  return newRadioGroupFields({
    idFor: index => 'f' + (stamp + index).toString().slice(-6),
    page: seed.page, x: seed.x, y: seed.y, to: seed.to, maxY: seed.maxY,
    label: metaOf('radio').label,
  });
}

export function useBuilderInteractions({ documentId, pageSize, pageSizes, pageCount, setFieldExtras, getFieldExtras }: BuilderInteractionsInput = {}) {
  const { s, set, flash, recip } = useSF();
  const { screen, go } = useNav();
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const sRef = useRef<SFState>(s);
  sRef.current = s;
  const extrasRef = useRef(setFieldExtras);
  extrasRef.current = setFieldExtras;
  const readExtrasRef = useRef(getFieldExtras);
  readExtrasRef.current = getFieldExtras;

  /** Carry one field's `options` onto a copy of it. */
  const copyExtras = useCallback((fromId: string, toId: string) => {
    const read = readExtrasRef.current, write = extrasRef.current;
    if (!read || !write) return;
    const source = read(fromId);
    if (!source || source.options === null || source.options === undefined) return;
    write(toId, { apiType: source.apiType, options: source.options as Record<string, unknown> });
  }, []);
  const dragRef = useRef<Drag | null>(null);
  /* One page box per page number — the document is drawn as a scrolling column
     of pages, so there is no single "the sheet" any more. */
  const sheetsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const sheetCbRef = useRef<Map<number, (node: HTMLDivElement | null) => void>>(new Map());
  const pageSizeRef = useRef<{ width: number; height: number } | null>(pageSize ?? null);
  pageSizeRef.current = pageSize ?? null;
  const pageSizesRef = useRef<{ width: number; height: number }[]>(pageSizes ?? []);
  pageSizesRef.current = pageSizes ?? [];
  /* How many pages the document has, which is the document's own fact — the
     rendered sizes above only cover the pages the viewer has measured so far. */
  const pageCountRef = useRef<number>(pageCount ?? 0);
  pageCountRef.current = Math.max(pageCount ?? 0, pageSizesRef.current.length);

  /** Ref callback for one page's box; stable per page so React does not thrash. */
  const registerSheet = useCallback((page: number) => {
    let cb = sheetCbRef.current.get(page);
    if (!cb) {
      cb = (node: HTMLDivElement | null) => {
        if (node) sheetsRef.current.set(page, node);
        else sheetsRef.current.delete(page);
      };
      sheetCbRef.current.set(page, cb);
    }
    return cb;
  }, []);

  const sizeOf = useCallback((page: number) => pageSizesRef.current[page - 1] ?? pageSizeRef.current, []);

  /** The page box under a viewport point, if any. */
  const sheetAt = useCallback((clientX: number, clientY: number) => {
    for (const [page, el] of sheetsRef.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return { page, el, rect: r };
    }
    return null;
  }, []);

  const snap = useCallback((v: number) => snapWith(sRef.current.grid, v), []);

  /** Keep a rectangle inside the real page (the API rejects one that isn't). */
  const clampToPage = useCallback((x: number, y: number, w: number, h: number, pageNumber?: number) => {
    const page = pageNumber ? sizeOf(pageNumber) : pageSizeRef.current;
    if (!page) return { x: Math.max(0, x), y: Math.max(0, y) };
    return {
      x: Math.max(0, Math.min(x, page.width - w)),
      y: Math.max(0, Math.min(y, page.height - h)),
    };
  }, [sizeOf]);

  /* ── drag / place ── */
  const onToolDown = useCallback((typeId: string, e: React.PointerEvent) => {
    e.preventDefault();
    set({ dragTool: typeId, ghost: { x: e.clientX, y: e.clientY } });
    if (screenRef.current !== 'builder') go('builder', { documentId });
  }, [set, go, documentId]);

  /**
   * Keyboard/click path to the same outcome as dragging a palette tool onto the
   * page (audit §8.9: the palette bound `onPointerDown` only, so a keyboard user
   * could focus a tool, press Enter, and nothing happened at all).
   *
   * The field lands in the middle of the current page, cascaded a little so
   * repeated presses do not stack exactly, and is left selected — which hands
   * the user straight to the keyboard machinery that already works: arrows
   * nudge 1pt, Shift+arrows 8pt, Delete removes, Cmd/Ctrl+D duplicates.
   */
  const placeTool = useCallback((typeId: string) => {
    const st = sRef.current;
    const t = metaOf(typeId);
    const page = sizeOf(st.page);
    const pageW = page ? page.width : 612;
    const pageH = page ? page.height : 792;
    const onPage = st.fields.filter(f => f.page === st.page).length;
    const cascade = (onPage % 8) * 12;
    const boxW = t.id === 'radio' ? RADIO_SIZE : t.w;
    const boxH = t.id === 'radio' ? RADIO_SIZE : t.h;
    const x = Math.max(0, Math.min(pageW - boxW, Math.round((pageW - boxW) / 2) + cascade));
    const y = Math.max(0, Math.min(pageH - boxH, Math.round((pageH - boxH) / 3) + cascade));
    if (t.id === 'radio') {
      const group = placeRadioGroup({ page: st.page, x, y, to: st.activeRecipient, maxY: pageH });
      set(prev => ({ fields: prev.fields.concat(group.fields), selected: [group.fields[0].id], dragTool: null, ghost: null }));
      if (extrasRef.current) {
        for (const f of group.fields) extrasRef.current(f.id, { apiType: 'radio', options: group.options[f.id] });
      }
      if (screenRef.current !== 'builder') go('builder', { documentId });
      flash(group.fields.length + ' radio buttons placed for ' + recip(st.activeRecipient).name
        + ' · drag each one where it belongs, or add and rename them in the inspector');
      return;
    }
    const id = 'f' + Date.now().toString().slice(-6);
    const annotation = newAnnotationExtras(t.id);
    const nf: SFField = {
      id, page: st.page, type: t.id, x, y, w: t.w, h: t.h,
      to: st.activeRecipient, required: !annotation && (t.id === 'signature' || t.id === 'initials'),
      // An annotation is the sender's own mark: nobody is asked to fill it in,
      // which the API enforces on its side too (`_apply_annotation_rules`).
      readOnly: !!annotation, label: t.label, placeholder: '',
      validation: t.id === 'email' ? 'email' : (t.id === 'date' ? 'date' : 'none'),
      cond: null
    };
    set(prev => ({ fields: prev.fields.concat([nf]), selected: [id], dragTool: null, ghost: null }));
    if (annotation && extrasRef.current) extrasRef.current(id, annotation);
    if (screenRef.current !== 'builder') go('builder', { documentId });
    flash(annotation
      ? t.label + ' placed on page ' + st.page + ' · type its text in the inspector'
      : t.label + ' placed for ' + recip(st.activeRecipient).name + ' · arrows nudge, Shift+arrows by 8, Delete removes');
  }, [set, flash, recip, go, documentId, sizeOf]);

  const onFieldDown = useCallback((id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const st = sRef.current;
    const add = e.shiftKey || e.metaKey;
    const selected = add
      ? (st.selected.indexOf(id) > -1 ? st.selected.filter(x => x !== id) : st.selected.concat([id]))
      : (st.selected.indexOf(id) > -1 ? st.selected : [id]);
    set({ selected });
    const ids = selected.length ? selected : [id];
    const anchor = st.fields.find(f => f.id === id);
    if (!anchor) return;
    const anchorSheet = sheetsRef.current.get(anchor.page);
    const anchorRect = anchorSheet ? anchorSheet.getBoundingClientRect() : null;
    dragRef.current = {
      mode: 'move', ids,
      sx: e.clientX, sy: e.clientY,
      orig: st.fields.filter(f => ids.indexOf(f.id) > -1).map(f => ({ id: f.id, x: f.x, y: f.y, page: f.page })),
      grabX: anchorRect ? (e.clientX - anchorRect.left) / st.zoom - anchor.x : anchor.w / 2,
      grabY: anchorRect ? (e.clientY - anchorRect.top) / st.zoom - anchor.y : anchor.h / 2,
    };
  }, [set]);

  const onResizeDown = useCallback((id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const f = sRef.current.fields.find(x => x.id === id);
    if (!f) return;
    dragRef.current = { mode: 'resize', ids: [id], sx: e.clientX, sy: e.clientY, orig: [{ id, w: f.w, h: f.h }] };
  }, []);

  const onSheetDown = useCallback((e: React.PointerEvent) => {
    const st = sRef.current;
    if (st.dragTool) return;
    const sheet = e.currentTarget as HTMLDivElement;
    const page = Number(sheet.getAttribute('data-pdf-page')) || st.page;
    const r = sheet.getBoundingClientRect();
    const z = st.zoom;
    const x0 = (e.clientX - r.left) / z, y0 = (e.clientY - r.top) / z;
    /* ANN-1: in pen mode the same drag draws instead of lassoing. The stroke is
       collected raw — no snapping — because a hand-drawn line pulled onto an
       8pt grid is not the line the sender drew. */
    if (st.penMode) {
      e.preventDefault();
      dragRef.current = { mode: 'pen', page, points: [[x0, y0]] };
      set({ selected: [], marquee: null, page, penStroke: { page, points: [[x0, y0]] } });
      return;
    }
    dragRef.current = { mode: 'lasso', x0, y0, page };
    // Clicking a page in the scrolling column makes it the active page, so the
    // palette, the inspector and the page rail all follow the pointer.
    set({ selected: [], marquee: { x: x0, y: y0, w: 0, h: 0 }, page });
  }, [set]);

  const onMove = useCallback((e: PointerEvent) => {
    const st = sRef.current;
    if (st.dragTool) { set({ ghost: { x: e.clientX, y: e.clientY } }); return; }
    const d = dragRef.current;
    if (!d) return;
    const z = st.zoom;
    if (d.mode === 'move') {
      const anchor = d.orig[0];
      /* The document is one scrolling column of pages, so a move gesture can
         end over a page other than the one it started on. Whichever page is
         under the pointer wins: the anchor field follows the cursor into it and
         the rest of the selection shifts by the same number of pages. */
      const hit = sheetAt(e.clientX, e.clientY);
      const pageCount = pageSizesRef.current.length;
      const shift = hit ? hit.page - anchor.page : 0;
      const pageOf = (o: { page: number }) => {
        const p = o.page + shift;
        return pageCount ? Math.max(1, Math.min(pageCount, p)) : Math.max(1, p);
      };
      let dx: number, dy: number;
      if (hit) {
        dx = ((e.clientX - hit.rect.left) / z - d.grabX) - anchor.x;
        dy = ((e.clientY - hit.rect.top) / z - d.grabY) - anchor.y;
      } else {
        dx = (e.clientX - d.sx) / z;
        dy = (e.clientY - d.sy) / z;
      }
      const map: { [k: string]: { x: number; y: number; page: number } } = {};
      d.orig.forEach(o => {
        const f = st.fields.find(item => item.id === o.id);
        const page = pageOf(o);
        map[o.id] = Object.assign(
          { page },
          clampToPage(snap(o.x + dx), snap(o.y + dy), f ? f.w : 0, f ? f.h : 0, page),
        );
      });
      const moved = d.orig.map(o => map[o.id]);
      const dragPage = map[anchor.id] ? map[anchor.id].page : anchor.page;
      const guides: { axis: string; at: number }[] = [];
      if (moved.length === 1) {
        const m = moved[0];
        st.fields.forEach(f => {
          if (d.ids.indexOf(f.id) > -1 || f.page !== dragPage) return;
          if (Math.abs(f.x - m.x) <= 4) guides.push({ axis: 'v', at: f.x });
          if (Math.abs(f.y - m.y) <= 4) guides.push({ axis: 'h', at: f.y });
        });
      }
      set(prev => ({
        guides,
        page: dragPage,
        fields: prev.fields.map(f => (map[f.id] ? Object.assign({}, f, map[f.id]) : f)),
      }));
    } else if (d.mode === 'resize') {
      const o = d.orig[0];
      const f = st.fields.find(item => item.id === o.id);
      const page = f ? sizeOf(f.page) : pageSizeRef.current;
      const maxW = page && f ? page.width - f.x : Infinity;
      const maxH = page && f ? page.height - f.y : Infinity;
      /* A radio button is a dot: the ordinary 32 × 24 floor would stop the
         sender from ever sizing one to match the print on the page. */
      const minW = f && f.type === 'radio' ? RADIO_MIN_SIZE : 32;
      const minH = f && f.type === 'radio' ? RADIO_MIN_SIZE : 24;
      const w = Math.min(maxW, Math.max(minW, snap(o.w + (e.clientX - d.sx) / z)));
      const h = Math.min(maxH, Math.max(minH, snap(o.h + (e.clientY - d.sy) / z)));
      set(prev => ({ fields: prev.fields.map(f => (f.id === o.id ? Object.assign({}, f, { w, h }) : f)) }));
    } else if (d.mode === 'pen') {
      const sheet = sheetsRef.current.get(d.page);
      if (!sheet) return;
      const r = sheet.getBoundingClientRect();
      const size = sizeOf(d.page);
      const px = (e.clientX - r.left) / z, py = (e.clientY - r.top) / z;
      // Clamped to the page: the API rejects a field that does not fit inside
      // it, and a stroke trailed off the edge would author exactly that.
      const point: [number, number] = [
        Math.max(0, Math.min(size ? size.width : px, px)),
        Math.max(0, Math.min(size ? size.height : py, py)),
      ];
      const last = d.points[d.points.length - 1];
      // Sub-point moves are noise on a trackpad; dropping them keeps the blob
      // (and the PDF path) proportional to the mark rather than to the hardware.
      if (Math.abs(point[0] - last[0]) < 0.4 && Math.abs(point[1] - last[1]) < 0.4) return;
      d.points.push(point);
      set({ penStroke: { page: d.page, points: d.points.slice() } });
    } else if (d.mode === 'lasso') {
      const lassoPage = d.page ?? st.page;
      const sheet = sheetsRef.current.get(lassoPage);
      if (!sheet) return;
      const r = sheet.getBoundingClientRect();
      const x1 = (e.clientX - r.left) / z, y1 = (e.clientY - r.top) / z;
      const m = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
      const hits = st.fields.filter(f => f.page === lassoPage &&
        f.x < m.x + m.w && f.x + f.w > m.x && f.y < m.y + m.h && f.y + f.h > m.y).map(f => f.id);
      set({ marquee: m, selected: hits });
    }
  }, [set, snap, clampToPage, sizeOf, sheetAt]);

  const onUp = useCallback((e: PointerEvent) => {
    const st = sRef.current;
    if (st.dragTool) {
      const t = metaOf(st.dragTool);
      const hit = sheetAt(e.clientX, e.clientY);
      const r = hit && hit.rect;
      if (hit && r) {
        const z = st.zoom;
        const id = 'f' + Date.now().toString().slice(-6);
        const dropW = t.id === 'radio' ? RADIO_SIZE : t.w;
        /* A radio group is dropped as a column of buttons, so the pointer lands
           on the *first* one rather than in the middle of a block. */
        const dropH = t.id === 'radio' ? RADIO_SIZE + RADIO_PITCH * 2 : t.h;
        const at = clampToPage(
          snap((e.clientX - r.left) / z - dropW / 2),
          snap((e.clientY - r.top) / z - dropH / 2),
          dropW, dropH, hit.page,
        );
        if (t.id === 'radio') {
          const size = sizeOf(hit.page);
          const group = placeRadioGroup({
            page: hit.page, x: at.x, y: at.y, to: st.activeRecipient,
            maxY: size ? size.height : undefined,
          });
          set(prev => ({ fields: prev.fields.concat(group.fields), selected: [group.fields[0].id], dragTool: null, ghost: null, page: hit.page }));
          if (extrasRef.current) {
            for (const f of group.fields) extrasRef.current(f.id, { apiType: 'radio', options: group.options[f.id] });
          }
          flash(group.fields.length + ' radio buttons placed on page ' + hit.page
            + ' for ' + recip(st.activeRecipient).name + ' · drag each one where it belongs');
          return;
        }
        const annotation = newAnnotationExtras(t.id);
        const nf: SFField = {
          id, page: hit.page, type: t.id,
          x: at.x, y: at.y,
          w: t.w, h: t.h, to: st.activeRecipient,
          required: !annotation && (t.id === 'signature' || t.id === 'initials'),
          readOnly: !!annotation, label: t.label, placeholder: '',
          validation: t.id === 'email' ? 'email' : (t.id === 'date' ? 'date' : 'none'),
          cond: null
        };
        set(prev => ({ fields: prev.fields.concat([nf]), selected: [id], dragTool: null, ghost: null, page: hit.page }));
        if (annotation && extrasRef.current) extrasRef.current(id, annotation);
        flash(annotation
          ? t.label + ' placed on page ' + hit.page + ' · type its text in the inspector'
          : t.label + ' placed on page ' + hit.page + ' and assigned to ' + recip(st.activeRecipient).name);
      } else {
        set({ dragTool: null, ghost: null });
      }
      return;
    }
    const drag = dragRef.current;
    if (drag && drag.mode === 'pen') {
      dragRef.current = null;
      const points = drag.points;
      // A tap with no drag is still a dot, but a stroke cannot be saved without
      // somewhere to store it — nor if the screen never handed us the extras
      // writer, in which case the mark would be silently dropped on save.
      if (!points.length || !extrasRef.current) { set({ penStroke: null }); return; }
      const pad = Math.max(2, st.penWidth);
      const bounds = strokeBounds(points, pad);
      const size = sizeOf(drag.page);
      const x = Math.max(0, bounds.x), y = Math.max(0, bounds.y);
      const w = Math.min(bounds.w, size ? size.width - x : bounds.w);
      const h = Math.min(bounds.h, size ? size.height - y : bounds.h);
      const box = { x, y, w, h };
      const id = 'f' + Date.now().toString().slice(-6);
      const nf: SFField = {
        id, page: drag.page, type: 'drawing', x: box.x, y: box.y, w: box.w, h: box.h,
        to: st.activeRecipient, required: false, readOnly: true,
        label: 'Pen Drawing', placeholder: '', validation: 'none', cond: null,
      };
      set(prev => ({ fields: prev.fields.concat([nf]), selected: [id], penStroke: null }));
      extrasRef.current(id, {
        apiType: 'drawing',
        options: toDrawingOptions(points, box, { color: st.penInk, stroke: st.penWidth }),
      });
      flash('Drawing added on page ' + drag.page + ' · it is burned into the completed PDF');
      return;
    }
    if (drag) { dragRef.current = null; set({ marquee: null, guides: [] }); }
  }, [set, flash, recip, snap, clampToPage, sheetAt, sizeOf]);

  const deleteSel = useCallback(() => {
    const n = sRef.current.selected.length;
    if (!n) return;
    set(prev => ({ fields: prev.fields.filter(f => prev.selected.indexOf(f.id) < 0), selected: [] }));
    flash(n + (n === 1 ? ' field deleted' : ' fields deleted'));
  }, [set, flash]);

  const duplicateSel = useCallback(() => {
    const st = sRef.current;
    const sources = st.fields.filter(f => st.selected.indexOf(f.id) > -1);
    const dupes = sources
      .map((f, i) => Object.assign({}, f, { id: 'f' + (Date.now() + i).toString().slice(-6), x: f.x + 16, y: f.y + 16 }));
    if (!dupes.length) return;
    set(prev => ({ fields: prev.fields.concat(dupes), selected: dupes.map(d => d.id) }));
    sources.forEach((f, i) => copyExtras(f.id, dupes[i].id));
    flash(dupes.length + ' field(s) duplicated');
  }, [set, flash, copyExtras]);

  /* Placing the same field on every page, one press instead of one drag per
     page. Signature blocks, initials and date stamps are routinely wanted on
     all of them, and duplicating by hand across a 30-page contract is where
     senders miss a page. Each copy keeps the original's position, clamped to
     the page it lands on — pages in one PDF need not be the same size — and
     pages that already carry a copy of this field are left alone so pressing
     twice does not stack two fields per page. */
  const copyToAllPages = useCallback(() => {
    const st = sRef.current;
    const sources = st.fields.filter(f => st.selected.indexOf(f.id) > -1);
    const pages = pageCountRef.current;
    if (!sources.length || pages < 2) return;
    const stamp = Date.now();
    const copies: SFField[] = [];
    const from: { [id: string]: string } = {};
    sources.forEach((f, si) => {
      for (let page = 1; page <= pages; page++) {
        if (page === f.page) continue;
        // A copy already made for this page, by an earlier press or by hand.
        const taken = st.fields.some(other => other.page === page && other.type === f.type
          && other.to === f.to && other.label === f.label
          && Math.abs(other.x - f.x) < 1 && Math.abs(other.y - f.y) < 1);
        if (taken) continue;
        const at = clampToPage(f.x, f.y, f.w, f.h, page);
        const copy = Object.assign({}, f, {
          id: 'f' + (stamp + si * 1000 + page).toString().slice(-6),
          page, x: at.x, y: at.y,
        });
        copies.push(copy);
        from[copy.id] = f.id;
      }
    });
    if (!copies.length) { flash('Already on every page'); return; }
    set(prev => ({ fields: prev.fields.concat(copies) }));
    for (const copy of copies) copyExtras(from[copy.id], copy.id);
    flash(copies.length === 1 ? 'Copied to 1 more page' : 'Copied to ' + copies.length + ' more pages');
  }, [set, flash, clampToPage, copyExtras]);

  const selNow = useCallback((): SFField[] => {
    const st = sRef.current;
    return st.fields.filter(f => st.selected.indexOf(f.id) > -1);
  }, []);

  const alignLeft = useCallback(() => {
    const sl = selNow();
    if (sl.length < 2) { flash('Select two or more fields to align'); return; }
    const x = Math.min.apply(null, sl.map(f => f.x) as any);
    const ids = sl.map(f => f.id);
    set(prev => ({ fields: prev.fields.map(f => (ids.indexOf(f.id) > -1 ? Object.assign({}, f, { x }) : f)) }));
  }, [selNow, set, flash]);

  const alignCenterX = useCallback(() => {
    const sl = selNow();
    if (sl.length < 2) { flash('Select two or more fields to align'); return; }
    const c = sl.reduce((a, f) => a + f.x + f.w / 2, 0) / sl.length;
    const ids = sl.map(f => f.id);
    set(prev => ({ fields: prev.fields.map(f => (ids.indexOf(f.id) > -1 ? Object.assign({}, f, { x: snap(c - f.w / 2) }) : f)) }));
  }, [selNow, set, flash, snap]);

  const distribute = useCallback(() => {
    const sl = selNow().slice().sort((a, b) => a.y - b.y);
    if (sl.length < 3) { flash('Select three or more fields to distribute'); return; }
    const top = sl[0].y, bottom = sl[sl.length - 1].y, gap = (bottom - top) / (sl.length - 1);
    const map: { [k: string]: number } = {};
    sl.forEach((f, i) => { map[f.id] = snap(top + gap * i); });
    set(prev => ({ fields: prev.fields.map(f => (map[f.id] !== undefined ? Object.assign({}, f, { y: map[f.id] }) : f)) }));
  }, [selNow, set, flash, snap]);

  const onKey = useCallback((e: KeyboardEvent) => {
    const tag = ((e.target as HTMLElement) && (e.target as HTMLElement).tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const st = sRef.current;
    if (screenRef.current !== 'builder') return;
    /* Escape puts the pen down. A mode with no way out but the mouse traps a
       keyboard user in it: every drag on the page would keep drawing. */
    if (e.key === 'Escape' && st.penMode) { e.preventDefault(); set({ penMode: false, penStroke: null }); return; }
    if (!st.selected.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 8 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const ids = st.selected;
      set(prev => ({ fields: prev.fields.map(f => (ids.indexOf(f.id) > -1
        ? Object.assign({}, f, clampToPage(f.x + dx, f.y + dy, f.w, f.h, f.page)) : f)) }));
    }
  }, [deleteSel, duplicateSel, set, clampToPage]);

  useEffect(() => {
    const move = (e: PointerEvent) => onMove(e);
    const up = (e: PointerEvent) => onUp(e);
    const key = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
    };
  }, [onMove, onUp, onKey]);

  return useMemo(() => ({
    registerSheet, onToolDown, placeTool, onFieldDown, onResizeDown, onSheetDown,
    deleteSel, duplicateSel, copyToAllPages, alignLeft, alignCenterX, distribute
  }), [registerSheet, onToolDown, placeTool, onFieldDown, onResizeDown, onSheetDown, deleteSel, duplicateSel, copyToAllPages, alignLeft, alignCenterX, distribute]);
}

/* ────────────────────────────────────────────────────────────────────────────
   Persistence for the prepare/builder and workflow screens.

   `useBuilderInteractions` above is untouched: it still owns every pointer and
   keyboard gesture and still writes straight into `s.fields`, so dragging stays
   a purely local, 60 fps operation. This hook wraps persistence *around* that —
   it watches the field set and pushes a full replace through
   `PUT /api/documents/{id}/fields` once the user has stopped moving, and offers
   explicit savers for recipients, routing and send.

   Why full replace: `s.fields` already *is* the whole field set, which is
   exactly the shape `field_service.bulk_save` takes. Trying to diff it into
   per-field PATCHes would mean tracking creates/deletes the interaction layer
   deliberately does not report.
   ──────────────────────────────────────────────────────────────────────────── */

import { apiCall } from '@/lib/api/browser';
import { documents as documentsApi, fields as fieldsApi, recipients as recipientsApi } from '@/lib/api/resources';
import {
  builderFieldKey,
  fieldResponseKey,
  toBuilderExtrasMap,
  toBuilderFields,
  toBuilderRecipients,
  toFieldBulkItems,
  toRecipientOrder,
  toRecipientSetItems,
  toRoutingUpdate,
  type BuilderFieldExtras,
  type BuilderRouting,
} from './adapters';
import type { Dict } from './data';
import type { Recipient } from './state';
import type { FieldResponse, RecipientCreate, RecipientResponse, WorkflowType } from '@/lib/api/types';

/** How long the field set must be quiet before it is written back. A pointer
 *  drag emits a change per `pointermove`, so this also serves as the drag
 *  boundary: nothing is sent until the gesture has ended. */
const FIELD_SAVE_DELAY_MS = 700;
/** Routing text inputs (subject, message) fire per keystroke. */
const ROUTING_SAVE_DELAY_MS = 600;

export type DocumentPersistenceInput = {
  documentId: string | null;
  /** The field rows as loaded, for the extras `SFField` cannot carry. */
  serverFields: FieldResponse[];
  serverRecipients: RecipientResponse[];
  /**
   * The exact array the screen seeds `s.fields` with. Comparing by identity is
   * how the autosave knows hydration has landed: until `s.fields` *is* this
   * array the store still holds the prototype's mock set, and writing that back
   * would replace the document's real fields with sample data.
   */
  seededFields: SFField[];
  /**
   * Whether this screen authors fields. The workflow screen only touches
   * recipients and routing, so it opts out and the field autosave stays off.
   */
  autosaveFields?: boolean;
};

export function useDocumentPersistence({ documentId, serverFields, serverRecipients, seededFields, autosaveFields = true }: DocumentPersistenceInput) {
  const { s, set, flash } = useSF();

  const sRef = useRef<SFState>(s);
  sRef.current = s;

  /** Ids the API has confirmed. Anything else was created locally and must be
   *  sent without an id — `bulk_save` rejects an id it does not own with a 400. */
  const serverFieldIds = useRef<Set<string>>(new Set(serverFields.map(f => f.id)));
  const serverRecipientIds = useRef<Set<string>>(new Set(serverRecipients.map(r => r.id)));
  const extras = useRef<Dict<BuilderFieldExtras>>(toBuilderExtrasMap(serverFields));
  /* The inspector edits `options` and `default_value`, which live here rather
     than on `SFField`. A ref alone would never repaint the inspector, so every
     write bumps this counter and the screen re-reads through `fieldExtras`. */
  const [extrasVersion, setExtrasVersion] = useState(0);

  /** Bumped on every local field change; lets a completed save tell whether the
   *  user has edited again while it was in flight. */
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRouting = useRef<Partial<BuilderRouting>>({});
  const baselined = useRef(false);

  /* Re-seed when the page hands us a different document (or fresh server data).
     Keyed on the *contents* of the server payload, not the identity of the
     arrays: a caller that passes a literal (`serverFields: []` on the workflow
     screen, which authors no fields) hands this effect a new array on every
     render, and the `setExtrasVersion` below would then re-render and re-run it
     forever. */
  const serverSignature = serverFields.map(f => f.id + ':' + f.updated_at).join(',')
    + '|' + serverRecipients.map(r => r.id).join(',');
  const seededSignature = useRef<string | null>(null);
  useEffect(() => {
    const signature = documentId + '|' + serverSignature;
    if (seededSignature.current === signature) return;
    seededSignature.current = signature;
    serverFieldIds.current = new Set(serverFields.map(f => f.id));
    serverRecipientIds.current = new Set(serverRecipients.map(r => r.id));
    extras.current = toBuilderExtrasMap(serverFields);
    setExtrasVersion(v => v + 1);
    revision.current = 0;
    savedRevision.current = 0;
    baselined.current = false;
    // `serverFields` / `serverRecipients` are read through the signature above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, serverSignature, seededFields]);

  /* ── fields ── */

  const pushFields = useCallback(async (): Promise<boolean> => {
    if (!documentId || inFlight.current) return false;
    const atRevision = revision.current;
    if (atRevision === savedRevision.current) return true;
    const fields = sRef.current.fields;
    const items = toFieldBulkItems(fields, extras.current, id => serverFieldIds.current.has(id));
    inFlight.current = true;
    const result = await fieldsApi.bulkSave(apiCall, documentId, items);
    inFlight.current = false;
    if (!result.ok) {
      // A 400 from field validation ("Field must fit inside the PDF page",
      // "Upload a PDF before placing fields", a bad condition target…) is the
      // API's own message and is shown verbatim.
      flash('Fields not saved · ' + result.error.message);
      return false;
    }
    savedRevision.current = atRevision;
    const saved = result.data;
    extras.current = toBuilderExtrasMap(saved);
    serverFieldIds.current = new Set(saved.map(f => f.id));

    // Newly created rows come back with server ids, and the response is sorted
    // by page/y/x rather than in request order — so local ids are re-keyed by
    // geometry, which is exactly what was sent. Only safe while the user has
    // not touched anything since; otherwise the next save recreates them (the
    // call is a full replace, so that cannot duplicate a row).
    if (revision.current !== atRevision) return true;
    const byKey: Dict<string[]> = {};
    for (const row of saved) {
      const key = fieldResponseKey(row);
      (byKey[key] || (byKey[key] = [])).push(row.id);
    }
    const remap: Dict<string> = {};
    let complete = true;
    for (const f of fields) {
      const bucket = byKey[builderFieldKey(f)];
      const next = bucket && bucket.length ? bucket.shift() : undefined;
      if (!next) { complete = false; break; }
      remap[f.id] = next;
    }
    if (!complete || fields.length !== saved.length) {
      // Could not line the two sets up (identical overlapping rectangles, or a
      // page the server clamped). Keep the local ids and let the canonical set
      // arrive on the next page load rather than shuffling the canvas.
      set({ fields: toBuilderFields(saved), selected: [] });
      return true;
    }
    if (fields.every(f => remap[f.id] === f.id)) return true;
    set(prev => ({
      fields: prev.fields.map(f => (remap[f.id] ? Object.assign({}, f, { id: remap[f.id] }) : f)),
      selected: prev.selected.map(id => remap[id] || id),
    }));
    return true;
  }, [documentId, flash, set]);

  /* Queue the same debounced write the canvas uses. Needed on its own because
     the autosave effect below watches `s.fields`, and an extras edit does not
     touch that array. */
  const scheduleFieldSave = useCallback(() => {
    if (!documentId || !autosaveFields) return;
    revision.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void pushFields(); }, FIELD_SAVE_DELAY_MS);
  }, [documentId, autosaveFields, pushFields]);

  /** What the inspector needs to render one field's choices and default. */
  const fieldExtras = useCallback((fieldId: string): BuilderFieldExtras | null => {
    void extrasVersion;
    return extras.current[fieldId] ?? null;
  }, [extrasVersion]);

  /** Edit the parts of a field `SFField` has no room for, and save them. */
  const setFieldExtras = useCallback((fieldId: string, patch: Partial<BuilderFieldExtras>) => {
    const current = extras.current[fieldId] ?? {
      apiType: 'text' as BuilderFieldExtras['apiType'],
      validationPattern: null,
      options: null,
      defaultValue: null,
    };
    extras.current = Object.assign({}, extras.current, { [fieldId]: Object.assign({}, current, patch) });
    setExtrasVersion(v => v + 1);
    scheduleFieldSave();
  }, [scheduleFieldSave]);

  /** Save right now — the "Save and close" button, and leaving the screen. */
  const saveFieldsNow = useCallback(() => {
    if (!autosaveFields) return Promise.resolve(true);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    return pushFields();
  }, [autosaveFields, pushFields]);

  /* Debounced autosave. `s.fields` gets a new array identity on every field
     mutation — including each `pointermove` of a drag — so the timer keeps
     being pushed out and the write lands once the gesture settles. */
  useEffect(() => {
    if (!documentId || !autosaveFields) return;
    if (!baselined.current) {
      // Nothing is written until the store holds the document's own fields.
      if (s.fields !== seededFields) return;
      baselined.current = true;
      return;
    }
    revision.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void pushFields(); }, FIELD_SAVE_DELAY_MS);
    return () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  }, [s.fields, seededFields, documentId, autosaveFields, pushFields]);

  /* ── recipients ── */

  const patchRecipient = useCallback((recipientId: string, body: Partial<RecipientCreate>) => {
    if (!documentId) return;
    // A row the server has never seen cannot be PATCHed; replace the set instead.
    if (!serverRecipientIds.current.has(recipientId)) { void saveRecipientsRef.current(); return; }
    void recipientsApi.update(apiCall, documentId, recipientId, body).then(result => {
      if (!result.ok) flash('Recipient not saved · ' + result.error.message);
    });
  }, [documentId, flash]);

  /** Full replace, order included — used when the local list holds a row the
   *  server has never seen (a recipient the sender has just added) or has
   *  dropped one (a removal). Resolves to `true` when the write landed. */
  const saveRecipients = useCallback(async (list?: Recipient[]): Promise<boolean> => {
    if (!documentId) return false;
    const current = list || sRef.current.recipients || [];
    const items = toRecipientSetItems(current, id => serverRecipientIds.current.has(id));
    const result = await recipientsApi.setAll(apiCall, documentId, items, sRef.current.routing as WorkflowType);
    if (!result.ok) { flash('Recipients not saved · ' + result.error.message); return false; }
    const saved = result.data;
    serverRecipientIds.current = new Set(saved.map(r => r.id));

    /* Re-key the local rows onto the ids the API just minted. Email is the
       identity to match on — the API rejects duplicates within an envelope —
       and it matters beyond tidiness: a field still pointing at a `local-…`
       recipient is rejected by `bulk_save` ("Recipient … does not belong to
       this document"), so the next field autosave would fail. */
    const idByEmail: Dict<string> = {};
    for (const row of saved) idByEmail[row.email.toLowerCase()] = row.id;
    const remap: Dict<string> = {};
    for (const r of current) {
      const next = idByEmail[r.email.toLowerCase()];
      if (next && next !== r.id) remap[r.id] = next;
    }
    set(prev => ({
      recipients: toBuilderRecipients(saved),
      fields: prev.fields.map(f => (remap[f.to] ? Object.assign({}, f, { to: remap[f.to] }) : f)),
      activeRecipient: remap[prev.activeRecipient] || prev.activeRecipient,
    }));
    return true;
  }, [documentId, flash, set]);

  /**
   * `DELETE /api/documents/{id}/recipients/{recipientId}`.
   *
   * Removing the *last* recipient cannot go through the full replace above —
   * `set_all` refuses an empty list ("At least one recipient is required") —
   * so the single-row delete is the only way to empty the envelope. The API
   * cascades the recipient's fields, which is why the caller drops them
   * locally too.
   */
  const deleteRecipient = useCallback(async (recipientId: string): Promise<boolean> => {
    if (!documentId) return false;
    if (!serverRecipientIds.current.has(recipientId)) return true; // never persisted
    const result = await recipientsApi.remove(apiCall, documentId, recipientId);
    if (!result.ok) { flash('Recipient not removed · ' + result.error.message); return false; }
    serverRecipientIds.current.delete(recipientId);
    return true;
  }, [documentId, flash]);
  const saveRecipientsRef = useRef(saveRecipients);
  saveRecipientsRef.current = saveRecipients;

  const saveRecipientOrder = useCallback((list: Recipient[]) => {
    if (!documentId) return;
    const ids = toRecipientOrder(list);
    if (!ids.length || ids.some(id => !serverRecipientIds.current.has(id))) { void saveRecipients(list); return; }
    void recipientsApi.reorder(apiCall, documentId, ids).then(result => {
      if (!result.ok) flash('Order not saved · ' + result.error.message);
    });
  }, [documentId, flash, saveRecipients]);

  /* ── routing ── */

  const pushRouting = useCallback(async () => {
    if (!documentId) return;
    const patch = pendingRouting.current;
    pendingRouting.current = {};
    if (!Object.keys(patch).length) return;
    const result = await documentsApi.updateRouting(apiCall, documentId, toRoutingUpdate(patch));
    if (!result.ok) flash('Routing not saved · ' + result.error.message);
  }, [documentId, flash]);

  /** Queue a routing change; the screen has already applied it locally. */
  const saveRouting = useCallback((patch: Partial<BuilderRouting>, immediate = false) => {
    pendingRouting.current = Object.assign({}, pendingRouting.current, patch);
    if (routingTimer.current) clearTimeout(routingTimer.current);
    if (immediate) { void pushRouting(); return; }
    routingTimer.current = setTimeout(() => { routingTimer.current = null; void pushRouting(); }, ROUTING_SAVE_DELAY_MS);
  }, [pushRouting]);

  const flushRouting = useCallback(() => {
    if (routingTimer.current) { clearTimeout(routingTimer.current); routingTimer.current = null; }
    return pushRouting();
  }, [pushRouting]);

  /* ── send ── */

  /** `POST /api/documents/{id}/send`. Everything pending is flushed first so the
   *  envelope goes out with the fields and routing on screen. */
  const sendEnvelope = useCallback(async (): Promise<boolean> => {
    if (!documentId) { flash('No document to send'); return false; }
    const fieldsOk = await saveFieldsNow();
    if (!fieldsOk) return false;
    await flushRouting();
    const result = await documentsApi.send(apiCall, documentId);
    if (!result.ok) { flash('Not sent · ' + result.error.message); return false; }
    const count = result.data.signing_links ? result.data.signing_links.length : 0;
    flash('Envelope sent · ' + count + (count === 1 ? ' invitation' : ' invitations') + ' delivered');
    return true;
  }, [documentId, flash, saveFieldsNow, flushRouting]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (routingTimer.current) clearTimeout(routingTimer.current);
  }, []);

  return useMemo(() => ({
    saveFieldsNow, fieldExtras, setFieldExtras,
    patchRecipient, saveRecipients, deleteRecipient, saveRecipientOrder, saveRouting, flushRouting, sendEnvelope,
  }), [saveFieldsNow, fieldExtras, setFieldExtras, patchRecipient, saveRecipients, deleteRecipient, saveRecipientOrder, saveRouting, flushRouting, sendEnvelope]);
}
