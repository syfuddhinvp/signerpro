'use client';
/* SignForge builder pointer/keyboard machinery — ported from the prototype app.js
   (onToolDown / onFieldDown / onResizeDown / onSheetDown / onMove / onUp / onKey,
    deleteSel / duplicateSel / alignLeft / alignCenterX / distribute). */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSF, type SFField, type SFState } from './state';
import { TYPES } from './data';

type Drag =
  | { mode: 'move'; ids: string[]; sx: number; sy: number; orig: { id: string; x: number; y: number }[] }
  | { mode: 'resize'; ids: string[]; sx: number; sy: number; orig: { id: string; w: number; h: number }[] }
  | { mode: 'lasso'; x0: number; y0: number };

const metaOf = (t: string) => TYPES.find(x => x.id === t) || TYPES[0];
const snapWith = (grid: boolean, v: number) => (grid ? Math.round(v / 8) * 8 : Math.round(v));

export function useBuilderInteractions() {
  const { s, set, flash, recip } = useSF();
  const sRef = useRef<SFState>(s);
  sRef.current = s;
  const dragRef = useRef<Drag | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const snap = useCallback((v: number) => snapWith(sRef.current.grid, v), []);

  /* ── drag / place ── */
  const onToolDown = useCallback((typeId: string, e: React.PointerEvent) => {
    e.preventDefault();
    set({ dragTool: typeId, ghost: { x: e.clientX, y: e.clientY }, screen: 'builder' });
  }, [set]);

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
    if (st.screen !== 'builder' || !st.selected.length) return;
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
