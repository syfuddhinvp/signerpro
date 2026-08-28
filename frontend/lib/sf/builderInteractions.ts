'use client';
/* SignForge builder pointer/keyboard machinery — ported from the prototype app.js
   (onToolDown / onFieldDown / onResizeDown / onSheetDown / onMove / onUp / onKey,
    deleteSel / duplicateSel / alignLeft / alignCenterX / distribute). */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSF, type SFField, type SFState } from './state';
import { useNav } from './nav';
import { TYPES } from './data';

type Drag =
  | { mode: 'move'; ids: string[]; sx: number; sy: number; orig: { id: string; x: number; y: number }[] }
  | { mode: 'resize'; ids: string[]; sx: number; sy: number; orig: { id: string; w: number; h: number }[] }
  | { mode: 'lasso'; x0: number; y0: number };

const metaOf = (t: string) => TYPES.find(x => x.id === t) || TYPES[0];
const snapWith = (grid: boolean, v: number) => (grid ? Math.round(v / 8) * 8 : Math.round(v));

/**
 * `documentId` only steers navigation: dragging a tool while some other screen
 * is showing jumps to the builder, and the builder is a per-document route, so
 * the gesture has to name the envelope it belongs to. Omitted, the document
 * already in the URL is carried over.
 */
export type BuilderInteractionsInput = { documentId?: string | null };

export function useBuilderInteractions({ documentId }: BuilderInteractionsInput = {}) {
  const { s, set, flash, recip } = useSF();
  const { screen, go } = useNav();
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const sRef = useRef<SFState>(s);
  sRef.current = s;
  const dragRef = useRef<Drag | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const snap = useCallback((v: number) => snapWith(sRef.current.grid, v), []);

  /* ── drag / place ── */
  const onToolDown = useCallback((typeId: string, e: React.PointerEvent) => {
    e.preventDefault();
    set({ dragTool: typeId, ghost: { x: e.clientX, y: e.clientY } });
    if (screenRef.current !== 'builder') go('builder', { documentId });
  }, [set, go, documentId]);

  const onFieldDown = useCallback((id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    const st = sRef.current;
    const add = e.shiftKey || e.metaKey;
    const selected = add
      ? (st.selected.indexOf(id) > -1 ? st.selected.filter(x => x !== id) : st.selected.concat([id]))
      : (st.selected.indexOf(id) > -1 ? st.selected : [id]);
    set({ selected });
    const ids = selected.length ? selected : [id];
    dragRef.current = {
      mode: 'move', ids,
      sx: e.clientX, sy: e.clientY,
      orig: st.fields.filter(f => ids.indexOf(f.id) > -1).map(f => ({ id: f.id, x: f.x, y: f.y }))
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
    const sheet = sheetRef.current;
    if (!sheet) return;
    const r = sheet.getBoundingClientRect();
    const z = st.zoom;
    const x0 = (e.clientX - r.left) / z, y0 = (e.clientY - r.top) / z;
    dragRef.current = { mode: 'lasso', x0, y0 };
    set({ selected: [], marquee: { x: x0, y: y0, w: 0, h: 0 } });
  }, [set]);

  const onMove = useCallback((e: PointerEvent) => {
    const st = sRef.current;
    if (st.dragTool) { set({ ghost: { x: e.clientX, y: e.clientY } }); return; }
    const d = dragRef.current;
    if (!d) return;
    const z = st.zoom;
    if (d.mode === 'move') {
      const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
      const map: { [k: string]: { x: number; y: number } } = {};
      d.orig.forEach(o => { map[o.id] = { x: Math.max(0, snap(o.x + dx)), y: Math.max(0, snap(o.y + dy)) }; });
      const moved = d.orig.map(o => map[o.id]);
      const guides: { axis: string; at: number }[] = [];
      if (moved.length === 1) {
        const m = moved[0];
        st.fields.forEach(f => {
          if (d.ids.indexOf(f.id) > -1 || f.page !== st.page) return;
          if (Math.abs(f.x - m.x) <= 4) guides.push({ axis: 'v', at: f.x });
          if (Math.abs(f.y - m.y) <= 4) guides.push({ axis: 'h', at: f.y });
        });
      }
      set(prev => ({ guides, fields: prev.fields.map(f => (map[f.id] ? Object.assign({}, f, map[f.id]) : f)) }));
    } else if (d.mode === 'resize') {
      const o = d.orig[0];
      const w = Math.max(32, snap(o.w + (e.clientX - d.sx) / z));
      const h = Math.max(24, snap(o.h + (e.clientY - d.sy) / z));
      set(prev => ({ fields: prev.fields.map(f => (f.id === o.id ? Object.assign({}, f, { w, h }) : f)) }));
    } else if (d.mode === 'lasso') {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const r = sheet.getBoundingClientRect();
      const x1 = (e.clientX - r.left) / z, y1 = (e.clientY - r.top) / z;
      const m = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
      const hits = st.fields.filter(f => f.page === st.page &&
        f.x < m.x + m.w && f.x + f.w > m.x && f.y < m.y + m.h && f.y + f.h > m.y).map(f => f.id);
      set({ marquee: m, selected: hits });
    }
  }, [set, snap]);

  const onUp = useCallback((e: PointerEvent) => {
    const st = sRef.current;
    if (st.dragTool) {
      const t = metaOf(st.dragTool);
      const sheet = sheetRef.current;
      const r = sheet && sheet.getBoundingClientRect();
      if (r && e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) {
        const z = st.zoom;
        const id = 'f' + Date.now().toString().slice(-6);
        const nf: SFField = {
          id, page: st.page, type: t.id,
          x: Math.max(0, snap((e.clientX - r.left) / z - t.w / 2)),
          y: Math.max(0, snap((e.clientY - r.top) / z - t.h / 2)),
          w: t.w, h: t.h, to: st.activeRecipient, required: t.id === 'signature' || t.id === 'initials',
          readOnly: false, label: t.label, placeholder: '',
          validation: t.id === 'email' ? 'email' : (t.id === 'date' ? 'date' : 'none'),
          cond: null, merge: ''
        };
        set(prev => ({ fields: prev.fields.concat([nf]), selected: [id], dragTool: null, ghost: null }));
        flash(t.label + ' placed and assigned to ' + recip(st.activeRecipient).name);
      } else {
        set({ dragTool: null, ghost: null });
      }
      return;
    }
    if (dragRef.current) { dragRef.current = null; set({ marquee: null, guides: [] }); }
  }, [set, flash, recip, snap]);

  const deleteSel = useCallback(() => {
    const n = sRef.current.selected.length;
    if (!n) return;
    set(prev => ({ fields: prev.fields.filter(f => prev.selected.indexOf(f.id) < 0), selected: [] }));
    flash(n + (n === 1 ? ' field deleted' : ' fields deleted'));
  }, [set, flash]);

  const duplicateSel = useCallback(() => {
    const st = sRef.current;
    const dupes = st.fields.filter(f => st.selected.indexOf(f.id) > -1)
      .map((f, i) => Object.assign({}, f, { id: 'f' + (Date.now() + i).toString().slice(-6), x: f.x + 16, y: f.y + 16 }));
    if (!dupes.length) return;
    set(prev => ({ fields: prev.fields.concat(dupes), selected: dupes.map(d => d.id) }));
    flash(dupes.length + ' field(s) duplicated');
  }, [set, flash]);

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
    if (screenRef.current !== 'builder' || !st.selected.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSel(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 8 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const ids = st.selected;
      set(prev => ({ fields: prev.fields.map(f => (ids.indexOf(f.id) > -1
        ? Object.assign({}, f, { x: Math.max(0, f.x + dx), y: Math.max(0, f.y + dy) }) : f)) }));
    }
  }, [deleteSel, duplicateSel, set]);

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
    sheetRef, onToolDown, onFieldDown, onResizeDown, onSheetDown,
    deleteSel, duplicateSel, alignLeft, alignCenterX, distribute
  }), [onToolDown, onFieldDown, onResizeDown, onSheetDown, deleteSel, duplicateSel, alignLeft, alignCenterX, distribute]);
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

  /** Bumped on every local field change; lets a completed save tell whether the
   *  user has edited again while it was in flight. */
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRouting = useRef<Partial<BuilderRouting>>({});
  const baselined = useRef(false);

  /* Re-seed when the page hands us a different document (or fresh server data). */
  useEffect(() => {
    serverFieldIds.current = new Set(serverFields.map(f => f.id));
    serverRecipientIds.current = new Set(serverRecipients.map(r => r.id));
    extras.current = toBuilderExtrasMap(serverFields);
    revision.current = 0;
    savedRevision.current = 0;
    baselined.current = false;
  }, [documentId, serverFields, serverRecipients, seededFields]);

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
   *  server has never seen. */
  const saveRecipients = useCallback(async (list?: Recipient[]) => {
    if (!documentId) return;
    const current = list || sRef.current.recipients || [];
    const items = toRecipientSetItems(current, id => serverRecipientIds.current.has(id));
    const result = await recipientsApi.setAll(apiCall, documentId, items, sRef.current.routing as WorkflowType);
    if (!result.ok) { flash('Recipients not saved · ' + result.error.message); return; }
    serverRecipientIds.current = new Set(result.data.map(r => r.id));
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
    saveFieldsNow, patchRecipient, saveRecipients, saveRecipientOrder, saveRouting, flushRouting, sendEnvelope,
  }), [saveFieldsNow, patchRecipient, saveRecipients, saveRecipientOrder, saveRouting, flushRouting, sendEnvelope]);
}
