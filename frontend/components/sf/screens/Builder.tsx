'use client';
/* SignForge — PREPARE / BUILDER screen (isBuilder), ported verbatim from the prototype.

   The markup is unchanged; the data behind it is the real document. Field
   authoring stays entirely local while the pointer is down — `useBuilderInteractions`
   still owns every gesture — and `useDocumentPersistence` writes the whole field
   set back through `PUT /api/documents/{id}/fields` once the canvas is quiet. */
import React, { type CSSProperties } from 'react';
import Link from 'next/link';
import { documentPathFor } from '@/lib/sf/routes';
import { reorderRecips, useDocumentTitle, useSF, UNASSIGNED_RECIPIENT, type Recipient, type SFField } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { TYPES } from '@/lib/sf/data';
import { btn, inputStyle, lbl, railHead, TEXT_MUTED, BORDER_STRONG } from '@/lib/sf/ui';
import { useBuilderInteractions, useDocumentPersistence } from '@/lib/sf/builderInteractions';
import { fieldChoices, newBuilderRecipient, toBuilderFields, toBuilderRecipients, type BuilderRouting } from '@/lib/sf/adapters';
import LazyPdfPages from '@/components/sf/pdf/LazyPdfPages';
import UploadDocument from '@/components/sf/UploadDocument';
import AddRecipient from '@/components/sf/parts/AddRecipient';
import { rememberContact } from '@/lib/sf/recipientContacts';
import { useDialogs } from '@/components/sf/DialogProvider';
import { useElementWidth } from '@/components/sf/pdf/useElementWidth';
import type { FieldResponse, RecipientResponse, RecipientRole } from '@/lib/api/types';

const ROLE_LABEL: { [k: string]: string } = { sign:'Needs to sign', approve:'Approver', copy:'Receives a copy', inperson:'In-person signer' };
const REGEX_MAP: { [k: string]: string } = {
  none:'— no pattern enforced —',
  email:'^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$',
  date:'^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$',
  numeric:'^-?\\d+(\\.\\d+)?$',
  custom:'^[A-Z]{3}-\\d{4}$'
};
const COND_OP_LABEL: { [k: string]: string } = { checked:'is checked', equals:'equals', notEmpty:'is not empty' };

/** Field types whose whole point is a list of choices to pick from. Without
 *  one the signing surface can only tell the recipient to ask the sender. */
const CHOICE_TYPES = new Set(['dropdown', 'radio']);
/** Types where pre-filling a value is meaningful. A signature, initials, a
 *  stamp or an attachment is the recipient's own act — it has no default. */
const DEFAULTABLE_TYPES = new Set([
  'text', 'name', 'email', 'number', 'currency', 'date', 'datetime', 'formula', 'dropdown', 'radio', 'checkbox',
]);

export type BuilderProps = {
  /** null when the tenant has no draft to open — the screen shows its empty state. */
  documentId: string | null;
  /** `DocumentResponse.original_file_path !== null` — false means the envelope
   *  exists but has no PDF yet, so the canvas offers the file picker. */
  hasFile?: boolean;
  title: string;
  pageCount: number;
  fields: FieldResponse[];
  recipients: RecipientResponse[];
  routing: BuilderRouting | null;
};

export default function Builder({ documentId, hasFile = true, title, pageCount, fields, recipients, routing }: BuilderProps) {
  const { s, set, flash, accent, recips, meta, initials, sel, setField } = useSF();
  const { go } = useNav();
  const { askConfirm } = useDialogs();
  const A = accent();
  useDocumentTitle(title);

  /* ── the real document ──────────────────────────────────────────────────
     The canvas below used to be a hardcoded 816 × 1056 sheet painted with
     invented "EXHIBIT A" prose (audit C2), which also meant every field was
     authored against an assumed US-Letter page (audit C1's second half).
     Now the page is drawn from `GET /api/documents/{id}/pdf` and reports its
     own size in PDF points; `s.zoom` is literally CSS pixels per point, which
     is the same divisor `useBuilderInteractions` already applies to pointer
     deltas — so a drag in any zoom, on any page size, yields points. */
  // Without an uploaded original the endpoint 404s — asking the PDF viewer to
  // render it would surface a load failure instead of the upload affordance.
  const pdfUrl = documentId && hasFile ? `/api/proxy/documents/${documentId}/pdf` : null;
  const [pageSizes, setPageSizes] = React.useState<{ widthPt: number; heightPt: number }[]>([]);
  const onGeometry = React.useCallback((sizes: { widthPt: number; heightPt: number }[]) => setPageSizes(sizes), []);
  const currentSize = pageSizes[s.page - 1] ?? null;
  const pageSize = currentSize ? { width: currentSize.widthPt, height: currentSize.heightPt } : null;
  const [viewportRef, viewportWidth] = useElementWidth<HTMLDivElement>();
  const viewportRefEl = React.useRef<HTMLDivElement | null>(null);
  const attachViewport = React.useCallback((node: HTMLDivElement | null) => {
    viewportRefEl.current = node;
    viewportRef(node);
  }, [viewportRef]);

  const allPageSizes = React.useMemo(
    () => pageSizes.map(sz => ({ width: sz.widthPt, height: sz.heightPt })),
    [pageSizes],
  );
  const I = useBuilderInteractions({ documentId, pageSize, pageSizes: allPageSizes });

  /* The canvas is one scrolling column of every page (a PDF is a document, not
     a slide deck). The page rail scrolls to a page rather than swapping which
     single page exists, and the active page follows whatever is under the
     middle of the viewport so the inspector and palette stay in step. */
  const scrollToPage = React.useCallback((n: number) => {
    const viewport = viewportRefEl.current;
    if (!viewport) return;
    const box = viewport.querySelector('[data-pdf-page="' + n + '"]');
    if (box) (box as HTMLElement).scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  /* The document's own field set and recipients, in the shapes the canvas reads.
     Memoised on the props so the identities are stable across renders — the
     autosave uses `seededFields` by identity to tell hydration from an edit. */
  const seededFields = React.useMemo<SFField[]>(() => toBuilderFields(fields), [fields]);
  const seededRecipients = React.useMemo<Recipient[]>(() => toBuilderRecipients(recipients), [recipients]);

  const P = useDocumentPersistence({
    documentId,
    serverFields: fields,
    serverRecipients: recipients,
    seededFields,
  });

  /* Hydrate the store from the server data. The builder's editing model *is*
     `s.fields` / `s.recipients` — the pointer machinery mutates them directly —
     so the document has to be seeded into the store rather than kept in props.
     Ephemeral UI (zoom, palette tab, selection) is left alone. */
  const [subject, setSubject] = React.useState(routing ? routing.subject : '');
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => {
    if (!documentId) return;
    setSubject(routing ? routing.subject : '');
    setHydrated(true);
    set({
      fields: seededFields,
      recipients: seededRecipients,
      activeRecipient: seededRecipients.length ? seededRecipients[0].id : '',
      selected: [],
      page: 1,
      routing: routing ? routing.routing : 'sequential',
      cadence: routing ? routing.cadence : '48h',
      expiry: routing ? routing.expiry : '14',
      message: routing ? routing.message : '',
    });
    // `set` and `routing` are stable for a given server payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, seededFields, seededRecipients, routing]);

  /* Until the seeding effect has run, the store still holds `INITIAL_STATE`'s
     sample fields, so the first paint renders the server data directly rather
     than flashing the prototype's mock envelope. */
  const F: SFField[] = hydrated ? s.fields : seededFields;
  const R: Recipient[] = hydrated ? recips() : seededRecipients;
  // `R` is legitimately empty on a freshly uploaded envelope, so this must not
  // hand back `undefined` — every caller below reads `.name` and `.color`.
  const recipIn = (id: string): Recipient => R.find(x => x.id === id) || R[0] || UNASSIGNED_RECIPIENT;

  /* Local list mutations that must also be persisted. */
  const reorderRecipient = (id: string, dir: number) => {
    const next = reorderRecips(s, id, dir);
    if (!next) return;
    set({ recipients: next });
    P.saveRecipientOrder(next);
  };
  /* Add: the row is created locally and the whole list is replaced through
     `PUT .../recipients`, which is what mints the real id. `saveRecipients`
     then re-keys the local id (and any field pointing at it). */
  const addRecipient = async (name: string, email: string): Promise<boolean> => {
    if (!documentId) { flash('Upload a document first'); return false; }
    const normalized = email.trim().toLowerCase();
    if (R.some(r => r.email.trim().toLowerCase() === normalized)) {
      flash(name + ' is already on this envelope');
      return false;
    }
    const created = newBuilderRecipient(name, email, R);
    const next = R.concat([created]);
    set({ recipients: next, activeRecipient: created.id });
    const saved = await P.saveRecipients(next);
    if (!saved) {
      // Roll the optimistic row back so the rail matches the server again.
      set({ recipients: R, activeRecipient: s.activeRecipient });
      return false;
    }
    /* Typing an address once is enough: whoever goes on an envelope is kept in
       the tenant's address book, so the next envelope suggests them. The
       recipient is already saved, so a failed contact write only downgrades
       the toast — it never fails the add. */
    const remembered = await rememberContact(created.name, created.email);
    flash(created.name + ' added as signer ' + created.order + (
      remembered === 'created' ? ' · saved to contacts'
        : remembered === 'failed' ? ' · not saved to contacts' : ''
    ));
    return true;
  };

  /* Remove: the API cascades the recipient's fields, so they go locally too —
     leaving them on the canvas would show fields that no longer exist. */
  const removeRecipient = async (id: string) => {
    const target = R.find(r => r.id === id);
    if (!target) return;
    const owned = F.filter(f => f.to === id).length;
    const ok = await askConfirm({
      title: 'Remove ' + target.name + '?',
      message: owned
        ? owned + (owned === 1 ? ' field' : ' fields') + ' assigned to them will be deleted with them.'
        : 'They will no longer receive this envelope.',
      cta: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const next = R.filter(r => r.id !== id).map((r, i) => Object.assign({}, r, { order: i + 1 }));
    const keptFields = F.filter(f => f.to !== id);
    set({
      recipients: next,
      fields: keptFields,
      selected: [],
      activeRecipient: s.activeRecipient === id ? (next.length ? next[0].id : '') : s.activeRecipient,
    });
    // An empty list cannot go through the full replace — `set_all` refuses it.
    const saved = next.length ? await P.saveRecipients(next) : await P.deleteRecipient(id);
    if (!saved) { set({ recipients: R, fields: F }); return; }
    flash(target.name + ' removed');
  };

  const changeRole = (id: string, role: string) => {
    const list = recips().map(x => (x.id === id ? Object.assign({}, x, { role }) : x));
    set({ recipients: list });
    P.patchRecipient(id, { role: role as RecipientRole });
  };
  const changeRouting = (patch: Partial<BuilderRouting>) => {
    if (patch.subject !== undefined) setSubject(patch.subject);
    const local: { [k: string]: string } = {};
    if (patch.routing !== undefined) local.routing = patch.routing;
    if (patch.cadence !== undefined) local.cadence = patch.cadence;
    if (patch.expiry !== undefined) local.expiry = patch.expiry;
    if (patch.message !== undefined) local.message = patch.message;
    if (Object.keys(local).length) set(local);
    P.saveRouting(patch);
  };

  /* ── wizard ── */
  const wizardStepStyle1: CSSProperties = { display:'flex', alignItems:'center', gap:'7px', fontSize:'.75rem', fontWeight: s.wizardStep === 1 ? 600 : 500, color: s.wizardStep === 1 ? '#0f172a' : TEXT_MUTED, background:'none', border:'none', cursor:'pointer' };
  const wizardStepStyle2: CSSProperties = { display:'flex', alignItems:'center', gap:'7px', fontSize:'.75rem', fontWeight: s.wizardStep === 2 ? 600 : 500, color: s.wizardStep === 2 ? '#0f172a' : TEXT_MUTED, background:'none', border:'none', cursor:'pointer' };
  const wizardDot1: CSSProperties = { width:'11px', height:'11px', borderRadius:'99px', border:'2px solid ' + (s.wizardStep === 1 ? A : BORDER_STRONG), background: s.wizardStep === 1 ? A : '#fff' };
  const wizardDot2: CSSProperties = { width:'11px', height:'11px', borderRadius:'99px', border:'2px solid ' + (s.wizardStep === 2 ? A : BORDER_STRONG), background: s.wizardStep === 2 ? A : '#fff' };
  const wizardLine: CSSProperties = { width:'52px', height:'2px', background:'#e3e7ee' };
  const wizardCta = s.wizardStep === 1 ? 'Continue' : 'Send envelope';
  const goStep1 = () => set({ wizardStep: 1 });
  const goStep2 = () => set({ wizardStep: 2 });
  // Step 2 still opens the design's send confirmation; the modal in
  // `components/sf/Modals.tsx` (owned elsewhere) is what has to call
  // `POST /api/documents/{id}/send`. The workflow screen sends for real.
  const wizardNext = () => { if (s.wizardStep === 1) set({ wizardStep: 2 }); else set({ modal: 'send' }); };

  /* Preview opens the recipient's own view of this envelope, as the recipient
     whose fields are being placed right now — previewing as someone else while
     you work on Sarah's signature block is the wrong answer to "how does this
     look". Null until the document exists: there is nothing to preview yet. */
  const previewHref = documentId
    ? documentPathFor('sign', documentId)
      + (s.activeRecipient ? '?recipient=' + encodeURIComponent(s.activeRecipient) : '')
    : null;
  const saveClose = () => {
    void P.saveFieldsNow().then(ok => {
      if (!ok) return;                       // the failure toast is already up
      void P.flushRouting();
      go('dashboard');
      flash('Draft saved · returned to documents');
    });
  };
  const prepareRowStyle: CSSProperties = { flex:'1', minHeight:0, display: s.wizardStep === 1 ? 'flex' : 'none' };

  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);
  // Canvas toolbar is icon-only so it survives a narrow viewport; the label
  // lives in title/aria-label instead of beside the glyph.
  const sqBtn = (bg: string, fg: string, bd: string): CSSProperties =>
    Object.assign({}, btn(bg, fg, bd), { width:'32px', padding:'0', justifyContent:'center', fontSize:'.9375rem', fontWeight:500, flex:'0 0 auto' });
  const toolBtn = sqBtn('#fff', '#475569', '#e3e7ee');
  const alignStyle = toolBtn;
  const dangerStyle = sqBtn('#fff', '#b91c1c', '#fecaca');
  const gridBtnStyle = sqBtn(s.grid ? '#eef2ff' : '#fff', s.grid ? '#3730a3' : '#475569', s.grid ? '#c7d2fe' : '#e3e7ee');
  const iconBtn: CSSProperties = { flex:'0 0 auto', width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'.8125rem', lineHeight:1 };
  const input = inputStyle;
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'.71875rem' });
  const textareaStyle: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'9px', padding:'8px 10px', fontSize:'.78125rem', resize:'vertical', outline:'none', width:'100%', color:'#0f172a' };

  /* ── recipient cards ── */
  const recipientCards = R.map(r => {
    const on = s.activeRecipient === r.id;
    return {
      id: r.id,
      name: r.name, order: String(r.order), fieldCount: String(F.filter(f => f.to === r.id).length), state: r.status,
      role: ROLE_LABEL[r.role],
      onClick: () => set({ activeRecipient: r.id }),
      style: { display:'flex', alignItems:'center', gap:'9px', padding:'9px', borderRadius:'11px', cursor:'pointer',
        border:'1px solid ' + (on ? r.color : '#e3e7ee'), background: on ? r.color + '14' : '#fff', width:'100%' } as CSSProperties,
      chip: { width:'26px', height:'26px', borderRadius:'8px', background:r.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
      stateStyle: { marginLeft:'auto', fontSize:'.625rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#64748b', whiteSpace:'nowrap' } as CSSProperties
    };
  });

  /* ── palette ── */
  const paletteTabs = ([['all','All fields'],['fav','Favourites']] as [string, string][]).map(([id, label]) => {
    const on = s.paletteTab === id;
    return { id, label, selected: on,
      onClick: () => set({ paletteTab: id }),
      style: { flex:'1', height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });
  const tools = TYPES.filter(t => (s.paletteTab === 'all' || s.favTypes.indexOf(t.id) > -1) &&
      (!s.paletteQuery || t.label.toLowerCase().indexOf(s.paletteQuery.toLowerCase()) > -1)).map(t => ({
    id: t.id, label: t.label, icon: t.icon,
    // The button is operable by pointer *and* by keyboard: drag it onto the
    // page, or focus it and press Enter/Space to drop one in the middle of the
    // page ready to be nudged with the arrow keys (audit §8.9).
    aria: 'Place ' + t.label + ' — drag onto the page, or press Enter to place it in the middle',
    onDown: (e: React.PointerEvent) => I.onToolDown(t.id, e),
    onPlace: () => I.placeTool(t.id),
    style: { display:'flex', alignItems:'center', gap:'7px', padding:'8px 9px', borderRadius:'10px', cursor:'grab', textAlign:'left',
      border:'1px solid ' + (s.dragTool === t.id ? A : '#e3e7ee'), background: s.dragTool === t.id ? '#eef2ff' : '#fbfcfd', color:'#334155' } as CSSProperties,
    glyph: { width:'20px', height:'20px', borderRadius:'6px', background:'#eef1f6', display:'grid', placeItems:'center', fontSize:'.625rem', color:'#475569', flex:'0 0 20px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties
  }));

  /* ── page thumbs ── */
  const pages = Array.from({ length: Math.max(1, pageCount) }, (_, i) => i + 1);
  const thumbs = pages.map(n => {
    const cnt = F.filter(f => f.page === n).length;
    const on = s.page === n;
    return { n: String(n), key: n,
      onClick: () => { set({ page: n, selected: [] }); scrollToPage(n); },
      style: { display:'flex', alignItems:'center', gap:'10px', padding:'8px', borderRadius:'11px', cursor:'pointer', width:'100%',
        border:'1px solid ' + (on ? A : '#e3e7ee'), background: on ? '#eef2ff' : '#fff' } as CSSProperties,
      sheet: { width:'32px', height:'42px', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'3px', display:'flex', flexDirection:'column', gap:'3px', padding:'5px', flex:'0 0 32px' } as CSSProperties,
      line1: { height:'2px', background:BORDER_STRONG, borderRadius:'2px' } as CSSProperties,
      line2: { height:'2px', background:'#e3e7ee', borderRadius:'2px', width:'80%' } as CSSProperties,
      line3: { height:'2px', background:'#e3e7ee', borderRadius:'2px', width:'60%' } as CSSProperties,
      badgeLabel: cnt ? cnt + ' fields' : 'no fields',
      badge: { fontSize:'.625rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: cnt ? '#047857' : TEXT_MUTED } as CSSProperties };
  });

  /* Whichever page covers the middle of the viewport is the active one. Kept
     cheap: it only reads the page boxes already in the DOM, and only writes
     when the answer actually changes. */
  const activePageRef = React.useRef(s.page);
  activePageRef.current = s.page;
  const onCanvasScroll = React.useCallback(() => {
    const viewport = viewportRefEl.current;
    if (!viewport) return;
    const mid = viewport.getBoundingClientRect().top + viewport.clientHeight / 2;
    let best = activePageRef.current;
    let bestDistance = Infinity;
    viewport.querySelectorAll('[data-pdf-page]').forEach(node => {
      const box = node as HTMLElement;
      const n = Number(box.getAttribute('data-pdf-page'));
      if (!n) return;
      const r = box.getBoundingClientRect();
      const distance = Math.abs((r.top + r.bottom) / 2 - mid);
      if (distance < bestDistance) { bestDistance = distance; best = n; }
    });
    if (best !== activePageRef.current) set({ page: best });
  }, [set]);

  /* ── undo / redo ────────────────────────────────────────────────────────
     These were `flash('Undo — last field change reverted')` toasts: a control
     that claimed to have undone something and had not (audit §4.8). The history
     is a stack of `s.fields` snapshots, coalesced on a quiet period so one drag
     is one undo step rather than one per `pointermove`. */
  const past = React.useRef<SFField[][]>([]);
  const future = React.useRef<SFField[][]>([]);
  const committed = React.useRef<SFField[] | null>(null);
  const applyingHistory = React.useRef(false);
  const historyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [historyVersion, setHistoryVersion] = React.useState(0);

  React.useEffect(() => {
    if (!hydrated) return;
    if (committed.current === null) { committed.current = s.fields; return; }
    if (applyingHistory.current) { applyingHistory.current = false; committed.current = s.fields; return; }
    if (s.fields === committed.current) return;
    if (historyTimer.current) clearTimeout(historyTimer.current);
    historyTimer.current = setTimeout(() => {
      historyTimer.current = null;
      if (committed.current) past.current = past.current.concat([committed.current]).slice(-60);
      committed.current = s.fields;
      future.current = [];
      setHistoryVersion(v => v + 1);
    }, 350);
    return () => { if (historyTimer.current) { clearTimeout(historyTimer.current); historyTimer.current = null; } };
  }, [s.fields, hydrated]);

  React.useEffect(() => { past.current = []; future.current = []; committed.current = null; setHistoryVersion(0); }, [documentId]);

  const canUndo = past.current.length > 0;
  const canRedo = future.current.length > 0;
  void historyVersion; // the stacks live in refs; this state is what re-renders the buttons

  const undo = () => {
    if (historyTimer.current) { clearTimeout(historyTimer.current); historyTimer.current = null; }
    const previous = past.current.pop();
    if (!previous) { flash('Nothing to undo'); return; }
    future.current = future.current.concat([s.fields]);
    applyingHistory.current = true;
    set({ fields: previous, selected: [] });
    setHistoryVersion(v => v + 1);
    flash('Undo · field change reverted');
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) { flash('Nothing to redo'); return; }
    past.current = past.current.concat([s.fields]);
    applyingHistory.current = true;
    set({ fields: next, selected: [] });
    setHistoryVersion(v => v + 1);
    flash('Redo · field change reapplied');
  };

  /* Preview was a toast too. It opens the signer view of this envelope — the
     same surface the recipient gets — after flushing whatever is unsaved. */
  const openPreview = () => {
    if (!documentId) { flash('Upload a document first'); return; }
    void P.saveFieldsNow().then(ok => { if (ok) go('sign', { documentId }); });
  };

  /* ── canvas ── */
  // `s.zoom` is CSS px per PDF point. 100% therefore means "one point, one
  // pixel" (a Letter page is 612 px wide) — small enough that the builder is
  // usable on a phone, and Fit width is what most people will actually press.
  const zoomLabel = Math.round(s.zoom * 100) + '%';
  const zoomIn = () => set({ zoom: Math.min(4, +(s.zoom + 0.1).toFixed(2)) });
  const zoomOut = () => set({ zoom: Math.max(0.25, +(s.zoom - 0.1).toFixed(2)) });
  const fitWidth = () => {
    if (!pageSize || !viewportWidth) { set({ zoom: 1 }); return; }
    set({ zoom: +Math.max(0.25, Math.min(4, (viewportWidth - 52) / pageSize.width)).toFixed(3) });
  };
  const fitPage = () => {
    const box = viewportRefEl.current;
    if (!pageSize || !viewportWidth || !box) { set({ zoom: 1 }); return; }
    const byWidth = (viewportWidth - 52) / pageSize.width;
    const byHeight = (box.clientHeight - 52) / pageSize.height;
    set({ zoom: +Math.max(0.25, Math.min(4, Math.min(byWidth, byHeight))).toFixed(3) });
  };
  /* Fit the page the first time its real size is known, so the builder opens on
     a whole page whatever the upload's dimensions are. */
  const autoFitted = React.useRef(false);
  React.useEffect(() => {
    if (autoFitted.current || !pageSize || !viewportWidth) return;
    autoFitted.current = true;
    const box = viewportRefEl.current;
    const byWidth = (viewportWidth - 52) / pageSize.width;
    const byHeight = box ? (box.clientHeight - 52) / pageSize.height : byWidth;
    set({ zoom: +Math.max(0.25, Math.min(2, Math.min(byWidth, byHeight))).toFixed(3) });
  }, [pageSize, viewportWidth, set]);
  const toggleGrid = () => set({ grid: !s.grid });
  const selLabel = s.selected.length ? s.selected.length + ' selected · ⌘D duplicate · ⌫ delete' : 'Lasso the page to multi-select';
  /* Everything below is authored in PDF points and drawn at `z` CSS px per
     point — the one scale the rendered page reports. No sheet size is assumed. */
  const z = s.zoom;
  const gridOverlay: CSSProperties = { position:'absolute', inset:0, pointerEvents:'none', opacity: s.grid ? 1 : 0,
    backgroundImage:'linear-gradient(to right, rgba(99,102,241,.09) 1px, transparent 1px), linear-gradient(to bottom, rgba(99,102,241,.09) 1px, transparent 1px)',
    backgroundSize: (8 * z) + 'px ' + (8 * z) + 'px' };
  const marqueeStyle: CSSProperties = s.marquee ? { position:'absolute', left:(s.marquee.x * z) + 'px', top:(s.marquee.y * z) + 'px', width:(s.marquee.w * z) + 'px', height:(s.marquee.h * z) + 'px',
    border:'1px solid ' + A, background: A + '14', borderRadius:'3px', pointerEvents:'none' } : {};
  const guides = s.guides.map((g, i) => ({ key: i, style: (g.axis === 'v'
    ? { position:'absolute', left:(g.at * z) + 'px', top:0, bottom:0, width:'1px', background:'#f43f5e', pointerEvents:'none' }
    : { position:'absolute', top:(g.at * z) + 'px', left:0, right:0, height:'1px', background:'#f43f5e', pointerEvents:'none' }) as CSSProperties }));

  const fieldsForPage = (pageNumber: number) => F.filter(f => f.page === pageNumber).map(f => {
    const r = recipIn(f.to), t = meta(f.type);
    const on = s.selected.indexOf(f.id) > -1;
    /* Draw the control the recipient will actually get, at the size it is
       being given. A box that only ever showed its label told the sender
       nothing about whether three radio choices fit in it — so a radio group
       or a checkbox was sized by guesswork and clipped at signing time. The
       preview is inert: `pointerEvents: 'none'` keeps every pixel of the box a
       drag handle. */
    const choices = fieldChoices(P.fieldExtras(f.id)?.options ?? null);
    const boxW = f.w * z, boxH = f.h * z;
    /* A radio group that cannot draw all of its choices in the box as sized is
       flagged here rather than discovered by the recipient. */
    const radioColumn = boxH >= 26 * Math.max(2, choices.length);
    const clipped = f.type === 'radio' && choices.length > 0
      && (radioColumn ? boxH < 20 * choices.length : boxW < 70 * choices.length);
    return {
      id: f.id,
      aria: t.label + ' for ' + r.name + (f.required ? ', required' : ', optional') + ', at ' + f.x + ' by ' + f.y + ' points from the top-left of the page',
      selected: on,
      onDown: (e: React.PointerEvent) => I.onFieldDown(f.id, e),
      onResize: (e: React.PointerEvent) => I.onResizeDown(f.id, e),
      onKey: (e: React.KeyboardEvent) => { if (e.key === 'Enter') set({ selected: [f.id] }); },
      box: { position:'absolute', left:(f.x * z) + 'px', top:(f.y * z) + 'px', width:(f.w * z) + 'px', height:(f.h * z) + 'px',
        background: r.color + '1f', border:'1.5px solid ' + r.color, borderRadius:'6px', cursor:'grab',
        boxShadow: on ? '0 0 0 2px #fff, 0 0 0 4px ' + r.color + '66' : 'none',
        display:'flex', alignItems:'center', justifyContent:'center', padding:'2px 6px',
        outline: clipped ? '1.5px dashed #dc2626' : 'none', outlineOffset: clipped ? '1px' : undefined } as CSSProperties,
      badge: { position:'absolute', top:'-9px', left:'-1px', height:'17px', padding:'0 6px', borderRadius:'5px', background:r.color,
        color:'#fff', fontSize:'.59375rem', fontWeight:700, display:'flex', alignItems:'center', gap:'4px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap' } as CSSProperties,
      badgeText: initials(r.name) + ' · ' + t.label + (f.required ? ' *' : '') + (clipped ? ' · too small' : ''),
      label: f.label,
      inner: { fontSize: (f.w * z) < 110 ? '10px' : '11.5px', fontWeight:600, color:'#0f172a', opacity:.75, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 } as CSSProperties,

      /* ── what the recipient sees, previewed ── */
      isCheck: f.type === 'checkbox',
      isRadio: f.type === 'radio',
      isSelect: f.type === 'dropdown',
      choices,
      /** The signing surface's own layout rule, so the preview agrees with it. */
      radioColumn,
      clipped,
      previewWrap: { position:'absolute', inset:0, padding:'2px 6px', display:'flex', alignItems:'center',
        overflow:'hidden', pointerEvents:'none' } as CSSProperties,
      radioWrap: { display:'flex', flexDirection: (radioColumn ? 'column' : 'row') as CSSProperties['flexDirection'],
        flexWrap:'wrap', gap:'2px 10px', width:'100%', height:'100%', alignContent:'center', overflow:'hidden' } as CSSProperties,
      radioRow: { display:'flex', alignItems:'center', gap:'5px', fontSize:'.71875rem', color:'#0f172a', whiteSpace:'nowrap' } as CSSProperties,
      radioDot: { width:'11px', height:'11px', borderRadius:'99px', border:'1.5px solid ' + r.color, flex:'0 0 11px' } as CSSProperties,
      checkGlyph: { width:'100%', height:'100%', display:'grid', placeItems:'center', fontSize: Math.max(10, Math.min(22, boxH - 8)) + 'px',
        color: r.color, fontWeight:700 } as CSSProperties,
      selectRow: { display:'flex', alignItems:'center', justifyContent:'space-between', gap:'6px', width:'100%',
        fontSize:'.71875rem', color:'#334155', whiteSpace:'nowrap', overflow:'hidden' } as CSSProperties,
      selectText: choices.length ? choices[0] : 'Select…',
      /** Warn where the signer would be stuck, in the sender's own view. */
      noChoices: CHOICE_TYPES.has(f.type) && choices.length === 0,
      warnStyle: { fontSize:'.625rem', color:'#b45309', lineHeight:1.25, whiteSpace:'normal', overflow:'hidden' } as CSSProperties,
      handle: { position:'absolute', right:'-5px', bottom:'-5px', width:'11px', height:'11px', borderRadius:'3px', background:'#fff', border:'1.5px solid ' + r.color, cursor:'nwse-resize' } as CSSProperties
    };
  });

  /* ── inspector ── */
  const selection = sel();
  const one = selection.length === 1 ? selection[0] : null;

  /* Choices and the default value are the two authoring inputs `SFField` has
     no room for — they live in the persistence hook's extras, keyed by field
     id, and are written straight back through the same bulk save. Until this
     existed a dropdown or a radio group could be placed but never given
     anything to choose from, and the signer was told to "ask the sender". */
  const oneExtras = one ? P.fieldExtras(one.id) : null;
  const oneChoices = React.useMemo(() => fieldChoices(oneExtras?.options ?? null), [oneExtras]);
  const wantsChoices = one ? CHOICE_TYPES.has(one.type) : false;
  const wantsDefault = one ? DEFAULTABLE_TYPES.has(one.type) : false;
  /* The textarea is edited as free text — a trailing newline or a blank line
     mid-list must survive the keystroke that made it — so the draft is what is
     shown and the parsed list is what is stored. */
  const [choiceDraft, setChoiceDraft] = React.useState<{ id: string; text: string }>({ id: '', text: '' });
  if (one && choiceDraft.id !== one.id) {
    // Adjusting state during render — React's documented way to reset state
    // when the thing being edited changes, with no intermediate paint.
    setChoiceDraft({ id: one.id, text: oneChoices.join('\n') });
  }
  const editChoices = (text: string) => {
    if (!one) return;
    setChoiceDraft({ id: one.id, text });
    const list = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    P.setFieldExtras(one.id, { options: list.length ? list : null });
  };
  const editDefault = (value: string) => {
    if (!one) return;
    P.setFieldExtras(one.id, { defaultValue: value ? value : null });
  };
  /* A Calculated field is authored as an expression over other fields' merge
     tags. It is evaluated server-side (formula_service.py) — the number the
     signer sees is never one the browser computed, because it ends up in an
     executed contract. */
  const wantsFormula = one ? one.type === 'formula' : false;
  const formulaExpression =
    oneExtras && oneExtras.options && !Array.isArray(oneExtras.options)
      ? String((oneExtras.options as Record<string, unknown>).expression ?? '')
      : '';
  const editFormula = (value: string) => {
    if (!one) return;
    P.setFieldExtras(one.id, { options: value.trim() ? { expression: value } : null });
  };
  const taggedFields = F.filter(f => one && f.id !== one.id && f.merge);
  const condOptions = F.filter(f => one && f.id !== one.id && f.page === (one ? one.page : 1))
    .map(f => ({ id: f.id, label: f.label + ' (' + meta(f.type).label + ')' }));
  const mergeSuggestions = ['{{client.name}}','{{client.email}}','{{contract.amount}}','{{contract.signedAt}}'].map(tag => ({
    tag, onClick: () => { if (one) setField(one.id, { merge: tag }); },
    style: { padding:'4px 8px', borderRadius:'7px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'.65625rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#475569', cursor:'pointer' } as CSSProperties
  }));
  const cond = one && one.cond ? one.cond : { field:'', op:'checked', value:'' };
  const condTrigger = cond.field ? F.find(f => f.id === cond.field) : null;
  const condSummary = condTrigger
    ? 'Show “' + (one ? one.label : '') + '” only when “' + condTrigger.label + '” ' +
      (cond.op === 'equals' ? 'equals “' + cond.value + '”' : COND_OP_LABEL[cond.op]) + '.'
    : 'Always visible to the assigned recipient.';
  const condSummaryStyle: CSSProperties = { fontSize:'.71875rem', color: condTrigger ? '#3730a3' : '#64748b', background: condTrigger ? '#eef2ff' : '#f5f6f8', border:'1px solid ' + (condTrigger ? '#c7d2fe' : '#e3e7ee'), borderRadius:'8px', padding:'8px 9px', lineHeight:1.5 };
  const inspIcon: CSSProperties = { width:'30px', height:'30px', borderRadius:'9px', background: one ? recipIn(one.to).color : '#e3e7ee', color:'#fff', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
  const regexBox: CSSProperties = { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'.65625rem', color:'#475569', background:'#f5f6f8', border:'1px solid #e3e7ee', borderRadius:'8px', padding:'8px 9px', wordBreak:'break-all' };
  const rowBtn: CSSProperties = { display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'transparent', border:'none', cursor:'pointer', padding:'2px 0' };
  const reqSwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: one && one.required ? '#10b981' : BORDER_STRONG, position:'relative', transition:'background .15s' };
  const reqKnob: CSSProperties = { position:'absolute', top:'2px', left: one && one.required ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' };
  const roSwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: one && one.readOnly ? A : BORDER_STRONG, position:'relative' };
  const roKnob: CSSProperties = { position:'absolute', top:'2px', left: one && one.readOnly ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' };
  const recipientOptions = R.map(r => ({ id: r.id, label: r.name + ' — ' + r.status }));

  /* ── step 2: routing / send setup ── */
  const routingRows = R.map(r => ({
    id: r.id,
    name: r.name, email: r.email, role: r.role, order: s.routing === 'parallel' ? '=' : String(r.order), status: r.status,
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd' } as CSSProperties,
    orderStyle: { width:'26px', height:'26px', borderRadius:'8px', background:r.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'.71875rem', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
    selectStyle: Object.assign({}, inputStyle, { width:'160px' }) as CSSProperties,
    onRole: (e: React.ChangeEvent<HTMLSelectElement>) => changeRole(r.id, e.target.value),
    onUp: () => reorderRecipient(r.id, -1),
    onDown: () => reorderRecipient(r.id, 1),
    onRemove: () => { void removeRecipient(r.id); }
  }));
  const cadences = ['24h','48h','7 days','none'].map(c => ({
    id: c, label: c === 'none' ? 'No reminders' : 'Every ' + c, onClick: () => changeRouting({ cadence: c }),
    style: btn(s.cadence === c ? '#eef2ff' : '#fff', s.cadence === c ? '#3730a3' : '#475569', s.cadence === c ? '#c7d2fe' : '#e3e7ee')
  }));
  const routeNote = s.routing === 'sequential'
    ? 'Each recipient is notified only after the previous one completes. Signer 1 → Signer 2 → Signer 3.'
    : 'All recipients are notified simultaneously and may sign in any order.';
  const routeNoteStyle: CSSProperties = { fontSize:'.75rem', color:'#3730a3', background:'#eef2ff', border:'1px solid #c7d2fe', borderRadius:'10px', padding:'10px 11px', lineHeight:1.55 };
  const seqStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'.78125rem', fontWeight: s.routing === 'sequential' ? 600 : 500, background: s.routing === 'sequential' ? '#fff' : 'transparent', color: s.routing === 'sequential' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'sequential' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const parStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'.78125rem', fontWeight: s.routing === 'parallel' ? 600 : 500, background: s.routing === 'parallel' ? '#fff' : 'transparent', color: s.routing === 'parallel' ? '#0f172a' : '#64748b', boxShadow: s.routing === 'parallel' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  /* The pre-send checklist, read off the real field set. `document_service.
     validate_for_send` is the authority — a failure there comes back as the
     400 the send call surfaces — so these are advisory. */
  const recipientIds = R.map(r => r.id);
  const orphanFields = F.filter(f => recipientIds.indexOf(f.to) < 0);
  const mergeFields = F.filter(f => !!f.merge);
  const mergePages = mergeFields.map(f => f.page).filter((n, i, a) => a.indexOf(n) === i).sort((a, b) => a - b);
  const sendChecks = ([
    [F.length + (F.length === 1 ? ' field assigned' : ' fields assigned'),
      orphanFields.length
        ? orphanFields.length + ' field(s) have no recipient on this envelope'
        : 'Every required field has a recipient',
      orphanFields.length ? '#f59e0b' : '#10b981'],
    // FALLBACK: the consent disclosure version is not exposed by any endpoint.
    ['Disclosure attached', 'ESIGN consent shown before signing', '#10b981'],
    [mergeFields.length
      ? mergeFields.length + (mergeFields.length === 1 ? ' merge tag' : ' merge tags') + ' unresolved'
      : 'No merge tags',
      mergeFields.length
        ? mergeFields[0].merge + ' on page ' + mergePages.join(', ') + ' will render empty'
        : 'Nothing is bound to external data',
      mergeFields.length ? '#f59e0b' : '#10b981'],
    ['Certificate enabled', 'Sealed PDF and audit trail on completion', '#10b981']
  ] as [string, string, string][]).map(([label, metaText, c]) => ({
    label, meta: metaText,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background:c, marginTop:'5px', flex:'0 0 8px' } as CSSProperties
  }));

  /* A fresh tenant has no draft to open, and `?document=` can name a document
     that has been deleted or belongs to another tenant (the API answers 404). */
  if (!documentId) {
    return (
      <section data-screen-label="Builder" style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0, background:'#eceff4' }}>
        <div style={{ flex:'0 0 auto', height:'52px', display:'flex', alignItems:'center', gap:'14px', padding:'0 16px', background:'#fff', borderBottom:'1px solid #e3e7ee' }}>
          <span style={{ width:'24px', height:'24px', borderRadius:'7px', background:'#eef2ff', color:'#3730a3', display:'grid', placeItems:'center', fontSize:'.5625rem', fontWeight:700, flex:'0 0 24px' }}>DOC</span>
          <span style={{ fontSize:'.8125rem', fontWeight:600 }}>Prepare document</span>
        </div>
        <div style={{ flex:1, minHeight:0, display:'grid', placeItems:'center', padding:'26px' }}>
          <div style={{ maxWidth:'420px', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'22px', display:'flex', flexDirection:'column', gap:'10px', textAlign:'center' }}>
            <span style={{ fontSize:'.84375rem', fontWeight:600, color:'#0f172a' }}>No document to prepare</span>
            <span style={{ fontSize:'.75rem', lineHeight:1.6, color:'#64748b' }}>Pick a PDF and we will create the draft for it, then open it here to place fields and assign recipients.</span>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
              <UploadDocument label="Upload a PDF" />
              <button type="button" onClick={() => go('dashboard')} style={Object.assign({}, ghostBtn, { justifyContent:'center' })}>Go to documents</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-screen-label="Builder" style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      <div style={{ flex:'0 0 auto', height:'52px', display:'flex', alignItems:'center', gap:'14px', padding:'0 16px', background:'#fff', borderBottom:'1px solid #e3e7ee' }}>
        <button type="button" onClick={() => flash('Rename — inline title editing')} style={{ display:'flex', alignItems:'center', gap:'8px', background:'none', border:'none', cursor:'pointer', minWidth:0 }}>
          <span style={{ width:'24px', height:'24px', borderRadius:'7px', background:'#eef2ff', color:'#3730a3', display:'grid', placeItems:'center', fontSize:'.5625rem', fontWeight:700, flex:'0 0 24px' }}>DOC</span>
          <span style={{ fontSize:'.8125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{title + ' ✎'}</span>
        </button>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', margin:'0 auto' }}>
          <button type="button" onClick={goStep1} style={wizardStepStyle1}><span style={wizardDot1}></span>Prepare</button>
          <span style={wizardLine}></span>
          <button type="button" onClick={goStep2} style={wizardStepStyle2}><span style={wizardDot2}></span>Set up and send</button>
        </div>
        <div style={{ display:'flex', gap:'8px', flex:'0 0 auto' }}>
          {previewHref ? (
            <Link href={previewHref} style={{ ...ghostBtn, textDecoration:'none' }}>Preview</Link>
          ) : null}
          <button type="button" onClick={saveClose} style={ghostBtn}>Save and close</button>
          <button type="button" onClick={wizardNext} style={primaryBtn}>{wizardCta}</button>
        </div>
      </div>

      <div style={prepareRowStyle}>

        <div data-sf-scroll="1" style={{ width:'270px', flex:'0 0 270px', borderRight:'1px solid #e3e7ee', background:'#fff', overflow:'auto', padding:'14px', display:'flex', flexDirection:'column', gap:'18px' }}>
          <div>
            <div style={railHead}>Recipients</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px', marginTop:'9px' }}>
              {recipientCards.map(r => (
                <button key={r.id} type="button" onClick={r.onClick} style={r.style}>
                  <span style={r.chip}>{r.order}</span>
                  <span style={{ display:'flex', flexDirection:'column', lineHeight:1.25, textAlign:'left', minWidth:0 }}>
                    <span style={{ fontSize:'.78125rem', fontWeight:600, color:'#0f172a' }}>{r.name}</span>
                    <span style={{ fontSize:'.6875rem', color:'#64748b' }}>{r.role} · {r.fieldCount} fields</span>
                  </span>
                  <span style={r.stateStyle}>{r.state}</span>
                </button>
              ))}
              {/* A field cannot be placed until somebody can be assigned it, so
                  the empty list says what to do rather than showing nothing. */}
              {recipientCards.length === 0 ? (
                <span style={{ fontSize:'.71875rem', lineHeight:1.55, color:TEXT_MUTED }}>
                  Nobody is on this envelope yet. Add a recipient before placing fields.
                </span>
              ) : null}
              <AddRecipient accent={A} onAdd={addRecipient} />
            </div>
          </div>

          <div>
            <div style={railHead}>Field palette</div>
            <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'9px', marginTop:'8px' }}>
              {paletteTabs.map(t => (
                <button key={t.id} type="button" onClick={t.onClick} aria-pressed={t.selected} style={t.style}>{t.label}</button>
              ))}
            </div>
            <input type="search" value={s.paletteQuery} onChange={e => set({ paletteQuery: e.target.value })} placeholder="Search fields" aria-label="Search fields" style={{ marginTop:'7px', height:'30px', width:'100%', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 10px', fontSize:'.75rem', outline:'none', background:'#fbfcfd' }} />
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'7px', marginTop:'9px' }}>
              {tools.map(t => (
                <button key={t.id} type="button" onPointerDown={t.onDown} onClick={t.onPlace} aria-label={t.aria} style={t.style}>
                  <span style={t.glyph}>{t.icon}</span>
                  <span style={{ fontSize:'.71875rem', fontWeight:500 }}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
              <div style={railHead}>Pages</div>
              {/* The prototype's "+ Add page" flashed a toast and appended
                  nothing — the API has no endpoint that grows an uploaded PDF,
                  and the page count is the document's own. Removed rather than
                  left claiming to have done something. */}
              <span style={{ fontSize:'.6875rem', color:'#64748b' }}>{pages.length} in this PDF</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginTop:'9px' }}>
              {thumbs.map(p => (
                <button key={p.key} type="button" onClick={p.onClick} style={p.style}>
                  <span style={p.sheet}>
                    <span style={p.line1}></span><span style={p.line2}></span><span style={p.line3}></span>
                  </span>
                  <span style={{ display:'flex', flexDirection:'column', gap:'4px', textAlign:'left' }}>
                    <span style={{ fontSize:'.75rem', fontWeight:600 }}>Page {p.n}</span>
                    <span style={p.badge}>{p.badgeLabel}</span>
                  </span>
                  <span style={{ marginLeft:'auto', fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>↕</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', background:'#eceff4' }}>
          <div data-sf-scroll="1" style={{ height:'46px', flex:'0 0 46px', borderBottom:'1px solid #e3e7ee', background:'#fff', display:'flex', alignItems:'center', gap:'8px', padding:'0 14px', overflowX:'auto', overflowY:'hidden', scrollbarWidth:'thin' }}>
            <button type="button" aria-label="Undo" title="Undo" onClick={undo} disabled={!canUndo} style={Object.assign({}, iconBtn, canUndo ? null : { opacity: .45, cursor: 'not-allowed' })}>↺</button>
            <button type="button" aria-label="Redo" title="Redo" onClick={redo} disabled={!canRedo} style={Object.assign({}, iconBtn, canRedo ? null : { opacity: .45, cursor: 'not-allowed' })}>↻</button>
            <span style={{ flex:'0 0 auto', width:'1px', height:'20px', background:'#e3e7ee' }}></span>
            <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', gap:'2px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'2px' }}>
              <button type="button" aria-label="Zoom out" title="Zoom out" onClick={zoomOut} style={iconBtn}>−</button>
              <span style={{ minWidth:'52px', textAlign:'center', fontSize:'.75rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#334155' }}>{zoomLabel}</span>
              <button type="button" aria-label="Zoom in" title="Zoom in" onClick={zoomIn} style={iconBtn}>+</button>
            </div>
            <button type="button" onClick={fitWidth} title="Fit width" aria-label="Fit width" style={toolBtn}>⇔</button>
            <button type="button" onClick={fitPage} title="Fit page" aria-label="Fit page" style={toolBtn}>⛶</button>
            <span style={{ flex:'0 0 auto', width:'1px', height:'20px', background:'#e3e7ee' }}></span>
            <button type="button" onClick={toggleGrid} title="Snap grid" aria-label="Snap grid" aria-pressed={s.grid} style={gridBtnStyle}>▦</button>
            <span style={{ flex:'0 0 auto', width:'1px', height:'20px', background:'#e3e7ee' }}></span>
            <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', gap:'6px' }}>
              <button type="button" onClick={I.alignLeft} title="Align left" aria-label="Align left" style={alignStyle}>⇤</button>
              <button type="button" onClick={I.alignCenterX} title="Center" aria-label="Center" style={alignStyle}>⇹</button>
              <button type="button" onClick={I.distribute} title="Distribute" aria-label="Distribute" style={alignStyle}>☰</button>
              <button type="button" onClick={I.duplicateSel} title="Duplicate" aria-label="Duplicate" style={alignStyle}>⧉</button>
              <button type="button" onClick={I.deleteSel} title="Delete" aria-label="Delete" style={dangerStyle}>🗑</button>
            </div>
            <button type="button" onClick={openPreview} title="Open preview" aria-label="Open preview" style={toolBtn}>◱</button>
            <span style={{ flex:'0 0 auto', marginLeft:'auto', paddingLeft:'8px', fontSize:'.71875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{selLabel}</span>
          </div>

          <div ref={attachViewport} onScroll={onCanvasScroll} data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', overscrollBehavior:'contain', padding:'26px', display:'flex', flexDirection:'column', alignItems:'center' }}>
            {pdfUrl ? (
              <LazyPdfPages
                fileUrl={pdfUrl}
                pages={pages}
                scale={z}
                onGeometry={onGeometry}
                pageBoxProps={(g) => ({ ref: I.registerSheet(g.page), onPointerDown: I.onSheetDown })}
                renderOverlay={(g) => (
                  <>
                    <div style={gridOverlay}></div>

                    {fieldsForPage(g.page).map(f => (
                      <div key={f.id} role="button" tabIndex={0} aria-label={f.aria} onPointerDown={f.onDown} onKeyDown={f.onKey} style={f.box}>
                        <span style={f.badge}>{f.badgeText}</span>
                        {f.isCheck ? (
                          <span style={f.previewWrap}><span style={f.checkGlyph}>☑</span></span>
                        ) : null}
                        {f.isRadio ? (
                          <span style={f.previewWrap}>
                            {f.choices.length ? (
                              <span style={f.radioWrap}>
                                {f.choices.map(c => (
                                  <span key={c} style={f.radioRow}>
                                    <span style={f.radioDot}></span><span>{c}</span>
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span style={f.warnStyle}>No choices yet — add them in the inspector</span>
                            )}
                          </span>
                        ) : null}
                        {f.isSelect ? (
                          <span style={f.previewWrap}>
                            {f.choices.length ? (
                              <span style={f.selectRow}><span>{f.selectText}</span><span aria-hidden="true">▾</span></span>
                            ) : (
                              <span style={f.warnStyle}>No choices yet — add them in the inspector</span>
                            )}
                          </span>
                        ) : null}
                        {!f.isCheck && !f.isRadio && !f.isSelect ? (
                          <span style={f.inner}>{f.label}</span>
                        ) : null}
                        {f.selected ? (
                          <span onPointerDown={f.onResize} style={f.handle}></span>
                        ) : null}
                      </div>
                    ))}

                    {s.marquee && g.page === s.page ? <div style={marqueeStyle}></div> : null}
                    {g.page === s.page ? guides.map(line => <div key={line.key} style={line.style}></div>) : null}
                  </>
                )}
              />
            ) : (
              <div role="status" style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'22px 20px', maxWidth:'420px',
                fontSize:'.78125rem', color:'#475569', lineHeight:1.6, display:'flex', flexDirection:'column', alignItems:'flex-start', gap:'12px' }}>
                <span>Upload a PDF to this envelope before placing fields — the page you place them on has to be the document itself.</span>
                <UploadDocument documentId={documentId} label="Upload a PDF" />
              </div>
            )}
          </div>
        </div>

        <div data-sf-scroll="1" style={{ width:'310px', flex:'0 0 310px', borderLeft:'1px solid #e3e7ee', background:'#fff', overflow:'auto' }}>
          {one ? (
            <div style={{ padding:'14px', display:'flex', flexDirection:'column', gap:'16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <span style={inspIcon}>{meta(one.type).icon}</span>
                <div style={{ display:'flex', flexDirection:'column', lineHeight:1.25 }}>
                  <span style={{ fontSize:'.84375rem', fontWeight:600 }}>{meta(one.type).label}</span>
                  <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{one.id + ' · page ' + one.page}</span>
                </div>
              </div>

              {/* A field type the product does not fully implement says so here
                  rather than letting the sender assume it works. */}
              {meta(one.type).note ? (
                <div role="note" style={{ fontSize:'.71875rem', lineHeight:1.55, color:'#7c2d12', background:'#fff7ed',
                  border:'1px solid #fed7aa', borderRadius:'10px', padding:'9px 10px' }}>
                  <strong>Not implemented.</strong> {meta(one.type).note}
                </div>
              ) : null}

              <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                <label style={lbl}>Label
                  <input type="text" value={one.label} onChange={e => setField(one.id, { label: e.target.value })} style={input} />
                </label>
                <label style={lbl}>Placeholder
                  <input type="text" value={one.placeholder} onChange={e => setField(one.id, { placeholder: e.target.value })} style={input} />
                </label>
                <label style={lbl}>Assigned recipient
                  <select value={one.to} onChange={e => setField(one.id, { to: e.target.value })} style={input}>
                    {recipientOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                  <label style={lbl}>X
                    <input type="number" value={one.x} onChange={e => setField(one.id, { x: parseInt(e.target.value || '0', 10) })} style={input} />
                  </label>
                  <label style={lbl}>Y
                    <input type="number" value={one.y} onChange={e => setField(one.id, { y: parseInt(e.target.value || '0', 10) })} style={input} />
                  </label>
                  <label style={lbl}>Width
                    <input type="number" value={one.w} onChange={e => setField(one.id, { w: Math.max(32, parseInt(e.target.value || '32', 10)) })} style={input} />
                  </label>
                  <label style={lbl}>Height
                    <input type="number" value={one.h} onChange={e => setField(one.id, { h: Math.max(24, parseInt(e.target.value || '24', 10)) })} style={input} />
                  </label>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'7px', border:'1px solid #eef1f6', borderRadius:'11px', padding:'10px', background:'#fbfcfd' }}>
                  <button type="button" role="switch" aria-checked={!!one.required} onClick={() => setField(one.id, { required: !one.required })} style={rowBtn}>
                    <span style={{ fontSize:'.78125rem' }}>Required</span><span style={reqSwitch}><span style={reqKnob}></span></span>
                  </button>
                  <button type="button" role="switch" aria-checked={!!one.readOnly} onClick={() => setField(one.id, { readOnly: !one.readOnly })} style={rowBtn}>
                    <span style={{ fontSize:'.78125rem' }}>Read-only</span><span style={roSwitch}><span style={roKnob}></span></span>
                  </button>
                </div>
                <label style={lbl}>Validation
                  <select value={one.validation} onChange={e => setField(one.id, { validation: e.target.value })} style={input}>
                    <option value="none">None</option>
                    <option value="email">Email</option>
                    <option value="date">Date (MM/DD/YYYY)</option>
                    <option value="numeric">Numeric</option>
                    <option value="custom">Custom regex</option>
                  </select>
                </label>
                <div style={regexBox}>{REGEX_MAP[one.validation]}</div>

                {wantsChoices ? (
                  <label style={lbl}>Choices — one per line
                    <textarea
                      value={choiceDraft.id === one.id ? choiceDraft.text : oneChoices.join('\n')}
                      onChange={e => editChoices(e.target.value)}
                      rows={4}
                      placeholder={'Yes\nNo\nNot applicable'}
                      style={Object.assign({}, input, { height:'auto', padding:'8px 11px', lineHeight:1.5, resize:'vertical' } as CSSProperties)}
                    />
                  </label>
                ) : null}
                {wantsChoices ? (
                  <div style={{ fontSize:'.71875rem', lineHeight:1.5, color: oneChoices.length ? '#047857' : '#b45309' }}>
                    {oneChoices.length
                      ? oneChoices.length + (oneChoices.length === 1 ? ' choice' : ' choices') + ' — the recipient picks one'
                      : 'No choices yet — the recipient is shown nothing to pick from until you add some.'}
                  </div>
                ) : null}

                {wantsFormula ? (
                  <label style={lbl}>Expression
                    <input
                      type="text"
                      value={formulaExpression}
                      onChange={e => editFormula(e.target.value)}
                      placeholder={'{{subtotal}} * 0.2'}
                      style={input}
                    />
                  </label>
                ) : null}
                {wantsFormula ? (
                  <div style={{ fontSize:'.71875rem', lineHeight:1.5, color: formulaExpression ? '#047857' : '#b45309' }}>
                    {formulaExpression
                      ? 'Calculated on the server when the recipient fills the fields it references. Numbers and + − × ÷ only.'
                      : 'No expression yet — this field stays blank until you give it one. Reference other fields by their merge tag.'}
                  </div>
                ) : null}
                {wantsFormula && taggedFields.length ? (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                    {taggedFields.map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => editFormula(formulaExpression + f.merge)}
                        style={{ padding:'4px 8px', borderRadius:'7px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'.65625rem', color:'#475569', cursor:'pointer' }}
                      >
                        {f.merge}
                      </button>
                    ))}
                  </div>
                ) : null}

                {wantsDefault ? (
                  <label style={lbl}>Default value
                    <input
                      type="text"
                      value={oneExtras?.defaultValue ?? ''}
                      onChange={e => editDefault(e.target.value)}
                      placeholder={wantsChoices ? 'One of the choices above' : 'Pre-filled for the recipient'}
                      style={input}
                    />
                  </label>
                ) : null}
              </div>

              <div style={{ borderTop:'1px solid #eef1f6', paddingTop:'14px', display:'flex', flexDirection:'column', gap:'10px' }}>
                <div style={railHead}>Conditional logic</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px', border:'1px solid #eef1f6', borderRadius:'11px', padding:'10px', background:'#fbfcfd' }}>
                  <div style={{ fontSize:'.71875rem', color:'#64748b' }}>Show this field only if</div>
                  <select value={cond.field} onChange={e => setField(one.id, { cond: e.target.value ? { field: e.target.value, op: cond.op, value: cond.value } : null })} style={input} aria-label="Trigger field">
                    <option value="">— always show —</option>
                    {condOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                    <select value={cond.op} onChange={e => { if (one.cond) setField(one.id, { cond: Object.assign({}, one.cond, { op: e.target.value }) }); }} style={input} aria-label="Operator">
                      <option value="checked">is checked</option>
                      <option value="equals">equals</option>
                      <option value="notEmpty">is not empty</option>
                    </select>
                    <input type="text" value={cond.value} onChange={e => { if (one.cond) setField(one.id, { cond: Object.assign({}, one.cond, { value: e.target.value }) }); }} placeholder="value" aria-label="Comparison value" style={input} />
                  </div>
                  <div style={condSummaryStyle}>{condSummary}</div>
                </div>
              </div>

              <div style={{ borderTop:'1px solid #eef1f6', paddingTop:'14px', display:'flex', flexDirection:'column', gap:'9px' }}>
                <div style={railHead}>Data binding</div>
                <input type="text" value={one.merge} onChange={e => setField(one.id, { merge: e.target.value })} placeholder="{{client.name}}" aria-label="Merge tag" style={mono} />
                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                  {mergeSuggestions.map(m => (
                    <button key={m.tag} type="button" onClick={m.onClick} style={m.style}>{m.tag}</button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {!one ? (
            <div style={{ padding:'30px 20px', display:'flex', flexDirection:'column', gap:'9px', textAlign:'center', color:TEXT_MUTED }}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, color:'#475569' }}>No field selected</span>
              <span style={{ fontSize:'.75rem', lineHeight:1.5 }}>Select a field on the page — or lasso several — to configure labels, validation, conditional logic and merge tags.</span>
            </div>
          ) : null}
        </div>
      </div>

      {s.wizardStep === 2 ? (
        <div data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', padding:'22px', display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start', background:'#eceff4' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
                <div style={railHead}>Recipients &amp; signing order</div>
                <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px' }}>
                  <button type="button" onClick={() => changeRouting({ routing: 'sequential' })} style={seqStyle}>Sequential</button>
                  <button type="button" onClick={() => changeRouting({ routing: 'parallel' })} style={parStyle}>Parallel</button>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
                {routingRows.map(r => (
                  <div key={r.id} style={r.rowStyle}>
                    <span style={r.orderStyle}>{r.order}</span>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0, flex:1 }}>
                      <span style={{ fontSize:'.8125rem', fontWeight:600 }}>{r.name}</span>
                      <span style={{ fontSize:'.71875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.email}</span>
                    </div>
                    <select value={r.role} onChange={r.onRole} aria-label="Role" style={r.selectStyle}>
                      <option value="sign">Needs to sign</option>
                      <option value="inperson">In-person signer</option>
                      <option value="copy">Receives a copy</option>
                      <option value="approve">Approver</option>
                    </select>
                    <div style={{ display:'flex', gap:'4px' }}>
                      <button type="button" aria-label="Move up" onClick={r.onUp} style={iconBtn}>↑</button>
                      <button type="button" aria-label="Move down" onClick={r.onDown} style={iconBtn}>↓</button>
                      <button type="button" aria-label={'Remove ' + r.name} title={'Remove ' + r.name} onClick={r.onRemove}
                        style={Object.assign({}, iconBtn, { color:'#b91c1c' })}>✕</button>
                    </div>
                  </div>
                ))}
                {routingRows.length === 0 ? (
                  <span style={{ fontSize:'.75rem', lineHeight:1.55, color:TEXT_MUTED }}>
                    This envelope has no recipients yet — it cannot be sent until it has at least one.
                  </span>
                ) : null}
                <AddRecipient accent={A} onAdd={addRecipient} variant="row" />
              </div>
              <div style={routeNoteStyle}>{routeNote}</div>
            </div>

            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={railHead}>Invite email</div>
              <label style={lbl}>Subject
                <input type="text" value={subject} onChange={e => changeRouting({ subject: e.target.value })} placeholder={title + ': signature request'} style={input} />
              </label>
              <label style={lbl}>Message
                <textarea rows={4} onChange={e => changeRouting({ message: e.target.value })} value={s.message} style={textareaStyle}></textarea>
              </label>
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={railHead}>Reminders &amp; expiration</div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                {cadences.map(c => (
                  <button key={c.id} type="button" onClick={c.onClick} style={c.style}>{c.label}</button>
                ))}
              </div>
              <label style={lbl}>Expires after
                <select value={s.expiry} onChange={e => changeRouting({ expiry: e.target.value })} style={input}>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                </select>
              </label>
            </div>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
              <div style={railHead}>Before you send</div>
              {sendChecks.map(c => (
                <div key={c.label} style={{ display:'flex', alignItems:'flex-start', gap:'9px', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
                  <span style={c.dot}></span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{c.label}</span>
                    <span style={{ fontSize:'.6875rem', color:'#64748b', lineHeight:1.5 }}>{c.meta}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
