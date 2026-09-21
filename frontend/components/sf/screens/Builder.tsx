'use client';
/* SignerPro — PREPARE / BUILDER screen (isBuilder), ported verbatim from the prototype.

   The markup is unchanged; the data behind it is the real document. Field
   authoring stays entirely local while the pointer is down — `useBuilderInteractions`
   still owns every gesture — and `useDocumentPersistence` writes the whole field
   set back through `PUT /api/documents/{id}/fields` once the canvas is quiet. */
import React, { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { documentPathFor } from '@/lib/sf/routes';
import { reorderRecips, useDocumentTitle, useSF, UNASSIGNED_RECIPIENT, type Recipient, type SFField } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { TYPES } from '@/lib/sf/data';
import { btn, inputStyle, lbl, railHead, TEXT_MUTED, BORDER_STRONG } from '@/lib/sf/ui';
import { useBuilderInteractions, useDocumentPersistence, type AnnotationExtras } from '@/lib/sf/builderInteractions';
import {
  drawingOptions, INK_COLORS, isAnnotationType, MAX_PEN_WIDTH, MIN_PEN_WIDTH, strokePath,
  TEXTBOX_FONTS, TEXTBOX_SIZES, textboxFontStack, textboxOptions,
} from '@/lib/sf/annotations';
import { useFieldFavorites } from '@/lib/sf/fieldFavorites';
import { fieldTypeEnabled, useEnabledFieldTypes } from '@/lib/sf/orgFieldTypes';
import {
  amountInputFromCents, centsFromAmountInput, fieldChoices, newBuilderRecipient, paymentFieldOptions,
  splitEqualCents, toBuilderFields, toBuilderRecipients,
  type BuilderFieldExtras, type BuilderRouting,
} from '@/lib/sf/adapters';
import {
  nextRadioChoice, radioGroupMembers, radioMemberOptions, radioOptions, RADIO_MIN_SIZE,
  RADIO_PITCH, type RadioOptions,
} from '@/lib/sf/radioGroups';
import LazyPdfPages from '@/components/sf/pdf/LazyPdfPages';
import { UPLOAD_ACCEPT, MAX_UPLOAD_BYTES, isImageUpload } from '@/lib/sf/uploads';
import ImageCropDialog, { cropToParam, isWholeImage } from '@/components/sf/ImageCropDialog';
import type { CropRect } from '@/components/sf/ImageCropDialog';
import { effectiveValidation } from '@/lib/sf/fieldValidation';
import UploadDocument from '@/components/sf/UploadDocument';
import PdfBadge from '@/components/sf/parts/PdfBadge';
import AddRecipient from '@/components/sf/parts/AddRecipient';
import ResizableRail from '@/components/sf/parts/ResizableRail';
import { rememberContact } from '@/lib/sf/recipientContacts';
import { useDialogs } from '@/components/sf/DialogProvider';
import { useRouter } from 'next/navigation';
import { apiCall, errorMessage } from '@/lib/api/browser';
import { documents as documentsApi, payments as paymentsApi, platformCatalog as platformCatalogApi } from '@/lib/api/resources';
import { useElementWidth } from '@/components/sf/pdf/useElementWidth';
import type {
  FieldResponse, ImageFit, PaymentAccountResponse, PaymentAllocationInput,
  PaymentRequestResponse, PaymentSplitMode, RecipientResponse, RecipientRole,
} from '@/lib/api/types';
import Icon from '@/components/sf/Icon';

/** Stripe's own floor (`schemas/payment.py:STRIPE_MINIMUM_CHARGE_CENTS`) —
 *  mirrored here so a doomed allocation is flagged in the builder before the
 *  sender ever hits Save, not just after the API 400s. */
const STRIPE_MINIMUM_CHARGE_CENTS = 50;

/** The rail's own fourth choice: crop first, then fit what is left on the
 *  page. The API has no `custom` — a crop is a rectangle plus a real fit. */
type AddImageFit = ImageFit | 'custom';
const fitFor = (choice: AddImageFit): ImageFit => (choice === 'custom' ? 'fit' : choice);

const ROLE_LABEL: { [k: string]: string } = { sign:'Needs to sign', approve:'Approver', copy:'Receives a copy', inperson:'In-person signer' };
const REGEX_MAP: { [k: string]: string } = {
  none:'— no pattern enforced —',
  email:'^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$',
  date:'^(0[1-9]|1[0-2])/(0[1-9]|[12]\\d|3[01])/\\d{4}$',
  numeric:'^-?\\d+(\\.\\d+)?$',
  custom:'^[A-Z]{3}-\\d{4}$'
};
const VALIDATION_LABEL: { [k: string]: string } = { email:'Email', date:'Date', numeric:'Numeric', custom:'Custom regex' };
const COND_OP_LABEL: { [k: string]: string } = { checked:'is checked', equals:'equals', notEmpty:'is not empty' };

/** Field types whose whole point is a list of choices to pick from. Without
 *  one the signing surface can only tell the recipient to ask the sender. */

const CHOICE_TYPES = new Set(['dropdown', 'radio']);
/** Types where pre-filling a value is meaningful. A signature, initials, a
 *  stamp or an attachment is the recipient's own act — it has no default. */
const DEFAULTABLE_TYPES = new Set([
  'text', 'name', 'email', 'number', 'currency', 'date', 'datetime', 'dropdown', 'radio', 'checkbox',
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
  /** `DocumentResponse.source_catalog_slug` — set when this template is the
   *  curator's draft of a platform catalog form. Turns on the banner that
   *  saves the placement back into that form. */
  catalogSlug?: string | null;
  /** `DocumentResponse.is_template` — a template is already the blueprint, so
   *  the header drops the action that would make one from it. */
  isTemplate?: boolean;
};

export default function Builder({ documentId, hasFile = true, title, pageCount, fields, recipients, routing, catalogSlug = null, isTemplate = false }: BuilderProps) {
  const { s, set, flash, accent, recips, meta, initials, sel, setField } = useSF();
  const { go } = useNav();
  const { askConfirm, askText } = useDialogs();
  const { isFavorite, toggleFavorite, favoritesReady } = useFieldFavorites();
  /* Which tiles this organization offers at all (ORG-6). */
  const { enabled: enabledTypes } = useEnabledFieldTypes();
  const router = useRouter();
  const A = accent();
  /* Only ever true while the catalog banner's save is in flight. */
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  /* ── document name ──────────────────────────────────────────────────────
     The header name is editable in place: clicking it swaps the label for an
     input, Enter (or blur) commits through `POST /api/documents/{id}/rename`
     and Escape abandons the edit. `title` is a server prop, so the committed
     name is held locally until `router.refresh()` brings the new prop down —
     otherwise the header would flash back to the old name in between. */
  const [docTitle, setDocTitle] = React.useState(title);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(title);
  React.useEffect(() => { setDocTitle(title); }, [title]);
  useDocumentTitle(docTitle);

  const startRename = () => {
    if (!documentId) { flash('Upload a document first'); return; }
    setTitleDraft(docTitle);
    setRenaming(true);
  };
  const cancelRename = () => setRenaming(false);
  const commitRename = () => {
    if (!renaming) return;                   // blur after Escape already closed it
    setRenaming(false);
    const next = titleDraft.trim();
    if (!documentId || !next || next === docTitle) return;
    const previous = docTitle;
    setDocTitle(next);                       // optimistic: the header is the edit surface
    void documentsApi.rename(apiCall, documentId, next).then(res => {
      if (!res.ok) {
        setDocTitle(previous);
        flash(errorMessage(res) || 'Rename failed');
        return;
      }
      flash('Renamed to ' + next);
      router.refresh();
    });
  };

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
  /** 1..pageCount — the document's page numbers, as the rail and the ops read them. */
  const pages = Array.from({ length: Math.max(1, pageCount) }, (_, i) => i + 1);

  /* The nonce is bumped whenever the pages are rearranged: the path is
     unchanged but the bytes behind it are not, and without it the viewer would
     keep rendering the pages it has already parsed. */
  const [pdfNonce, setPdfNonce] = React.useState(0);
  const pdfUrl = documentId && hasFile
    ? `/api/proxy/documents/${documentId}/pdf` + (pdfNonce ? `?v=${pdfNonce}` : '')
    : null;
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
  /* Placing an annotation authors a payload (its strokes, or its face and size)
     at the moment the field is created, so the gesture machinery needs the
     extras writer — which belongs to the persistence hook declared below it.
     The indirection is this ref, filled in as soon as that hook exists. */
  const extrasSink = React.useRef<((id: string, patch: AnnotationExtras) => void) | null>(null);
  const writeExtras = React.useCallback((id: string, patch: AnnotationExtras) => {
    if (extrasSink.current) extrasSink.current(id, patch);
  }, []);
  /* The reader in the same shape, for the gestures that copy a field: a copy
     has to carry the original's `options` (a radio button's group, a
     dropdown's choices) or it is not a copy of that field at all. */
  const extrasSource = React.useRef<((id: string) => BuilderFieldExtras | null) | null>(null);
  const readExtras = React.useCallback((id: string) => (extrasSource.current ? extrasSource.current(id) : null), []);
  const I = useBuilderInteractions({
    documentId, pageSize, pageSizes: allPageSizes, pageCount: pages.length,
    setFieldExtras: writeExtras, getFieldExtras: readExtras,
  });

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
  extrasSink.current = P.setFieldExtras;
  extrasSource.current = P.fieldExtras;

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

  /* ── pages ───────────────────────────────────────────────────────────────
     A PDF arrives with a cover sheet nobody signs, or with its exhibits in the
     wrong order, and re-uploading a corrected file is not an option — the API
     refuses a second original. `PUT /api/documents/{id}/pages` takes the pages
     to keep in the order they should end up in, so removing a page and
     renumbering one are the same call.

     Pending field edits are flushed first: the server renumbers the field rows
     it holds, so an autosave still carrying the old page numbers must not land
     after the rewrite. Fields are then re-seeded from the refreshed props
     rather than remapped by hand, which keeps the canvas showing exactly what
     the server stored. */
  const [pageBusy, setPageBusy] = React.useState(false);
  const rearrangePages = async (order: number[], note: string) => {
    if (!documentId || pageBusy) return;
    setPageBusy(true);
    try {
      await P.saveFieldsNow();
      const res = await documentsApi.setPages(apiCall, documentId, order);
      if (!res.ok) { flash(errorMessage(res) || 'Pages could not be updated'); return; }
      set({ selected: [], page: Math.min(s.page, order.length) });
      setPdfNonce(n => n + 1);
      flash(note);
      router.refresh();
    } finally {
      setPageBusy(false);
    }
  };

  /* ── adding pages ────────────────────────────────────────────────────────
     The other half of page editing: an exhibit arrives late, a signature sheet
     is missing, or a signed addendum exists only as a photo. `POST
     /api/documents/{id}/pages` grows the document with either blank pages or
     the pages of an uploaded file (PDF, image or .docx — converted server-
     side), inserted at a page number. Fields at or after that point move down
     with their page, which is why pending edits are flushed first, exactly as
     they are for a rearrange. */
  const [addOpen, setAddOpen] = React.useState(false);
  /** Where new pages land: `0` means the end, otherwise "after page N". */
  const [addAfter, setAddAfter] = React.useState(0);
  const addFileRef = React.useRef<HTMLInputElement>(null);
  /* An image has no page size of its own. Left at its own pixel count a phone
     photo becomes a page several feet tall beside letter-sized ones, so the
     server lays it on a page the size of the one it joins; this chooses how. */
  const [addFit, setAddFit] = React.useState<AddImageFit>('fit');
  /* "Choose the area" holds the picked file back until the crop dialog says
     which part of it to keep — the upload is the same call either way, with a
     rectangle attached. */
  const [cropping, setCropping] = React.useState<File | null>(null);

  const addPages = async (opts: { file?: File; blankCount?: number; crop?: string }) => {
    if (!documentId || pageBusy) return;
    if (!hasFile) { flash('Upload a document first'); return; }
    setPageBusy(true);
    try {
      await P.saveFieldsNow();
      const at = addAfter > 0 ? Math.min(addAfter, pages.length) + 1 : undefined;
      const res = await documentsApi.addPages(apiCall, documentId, Object.assign({ at, fit: fitFor(addFit) }, opts));
      if (!res.ok) { flash(errorMessage(res) || 'Pages could not be added'); return; }
      const added = res.data.page_count - pages.length;
      setAddOpen(false);
      set({ selected: [] });
      setPdfNonce(n => n + 1);
      flash(added === 1 ? 'Page added' : added + ' pages added');
      router.refresh();
    } finally {
      setPageBusy(false);
    }
  };

  const onAddFile = (file: File | null | undefined) => {
    if (!file) return;
    if (file.size === 0) { flash('That file is empty'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { flash('That file is larger than 25 MB'); return; }
    // Only an image has an area to choose: a PDF or a .docx already has pages.
    if (addFit === 'custom' && isImageUpload(file.name)) { setCropping(file); return; }
    void addPages({ file });
  };

  /* The shape the new page will be: the page it follows (or the last one,
     when it is going on the end). Null until the viewer has reported the PDF's
     geometry, which is also when the crop frame has nothing to lock to. */
  const addPageAspect = React.useMemo(() => {
    const size = allPageSizes[(addAfter > 0 ? Math.min(addAfter, pages.length) : pages.length) - 1];
    return size && size.height > 0 ? size.width / size.height : null;
  }, [allPageSizes, addAfter, pages.length]);

  const onCropped = (file: File) => (crop: CropRect | null) => {
    setCropping(null);
    if (!crop) return;                       // dismissed — the file is not added
    void addPages({ file, crop: isWholeImage(crop) ? undefined : cropToParam(crop) });
  };

  const removePage = async (n: number) => {
    if (pages.length < 2) { flash('A document must keep at least one page'); return; }
    const owned = F.filter(f => f.page === n).length;
    const ok = await askConfirm({
      title: 'Delete page ' + n + '?',
      message: owned
        ? owned + (owned === 1 ? ' field' : ' fields') + ' on this page will be deleted with it, and the pages after it renumbered.'
        : 'The pages after it are renumbered. This rewrites the document.',
      cta: 'Delete page',
      danger: true,
    });
    if (!ok) return;
    await rearrangePages(pages.filter(p => p !== n), 'Page ' + n + ' deleted');
  };

  /** Move a page to a page number — pulled out of the order and put back in. */
  const movePageTo = async (n: number, to: number) => {
    if (to < 1 || to > pages.length || to === n) return;
    const order = pages.filter(p => p !== n);
    order.splice(to - 1, 0, n);
    await rearrangePages(order, 'Page ' + n + ' is now page ' + to);
  };

  /** One slot up or down — the arrows beside each page in the rail. */
  const movePage = (n: number, dir: number) => movePageTo(n, n + dir);

  /* ── dragging a page to a new position ───────────────────────────────────
     The arrows move a page one slot at a time, which is a lot of presses to
     get page 12 to the front of a long document. Dragging a page in the rail
     is the same edit — `movePageTo` — reached by pointing at where it should
     go. The rail keeps the arrows: they are the keyboard path to this, and a
     drag is an enhancement rather than the only way in.

     `dragPage` is the page being carried; `dropBefore` is the slot the drop
     would land in, which is what the insertion line is drawn from. */
  const [dragPage, setDragPage] = React.useState<number | null>(null);
  const [dropBefore, setDropBefore] = React.useState<number | null>(null);
  const endPageDrag = () => { setDragPage(null); setDropBefore(null); };
  const onPageDragStart = (n: number) => (e: React.DragEvent) => {
    if (pageBusy) { e.preventDefault(); return; }
    setDragPage(n);
    // Text, because that is the one type every browser lets a drag carry; the
    // page being moved is read off `dragPage`, not off the payload.
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(n)); } catch { /* older Safari */ }
    }
  };
  /* Which half of the row the pointer is in decides whether the page lands
     before or after it — without that, dragging onto the last row could never
     mean "put it last". */
  const onPageDragOver = (n: number) => (e: React.DragEvent) => {
    if (dragPage === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const box = e.currentTarget.getBoundingClientRect();
    const lower = box.height > 0 && e.clientY > box.top + box.height / 2;
    setDropBefore(lower ? n + 1 : n);
  };
  const onPageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragPage;
    const before = dropBefore;
    endPageDrag();
    if (from === null || before === null) return;
    /* `dropBefore` counts slots in the list as it stands. Pulling the dragged
       page out first shifts every slot after it down by one, so a drop below
       its old position lands one earlier than the raw slot number. */
    const to = before > from ? before - 1 : before;
    if (to === from) return;
    void movePageTo(from, to);
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
  const wizardStepStyle1: CSSProperties = { display:'flex', alignItems:'center', gap:'7px', fontSize:'.75rem', fontWeight: s.wizardStep === 1 ? 600 : 500, color: s.wizardStep === 1 ? 'hsl(var(--color-fg-default))' : TEXT_MUTED, background:'none', border:'none', cursor:'pointer' };
  const wizardStepStyle2: CSSProperties = { display:'flex', alignItems:'center', gap:'7px', fontSize:'.75rem', fontWeight: s.wizardStep === 2 ? 600 : 500, color: s.wizardStep === 2 ? 'hsl(var(--color-fg-default))' : TEXT_MUTED, background:'none', border:'none', cursor:'pointer' };
  const wizardDot1: CSSProperties = { width:'11px', height:'11px', borderRadius:'99px', border:'2px solid ' + (s.wizardStep === 1 ? A : BORDER_STRONG), background: s.wizardStep === 1 ? A : 'hsl(var(--color-bg-surface))' };
  const wizardDot2: CSSProperties = { width:'11px', height:'11px', borderRadius:'99px', border:'2px solid ' + (s.wizardStep === 2 ? A : BORDER_STRONG), background: s.wizardStep === 2 ? A : 'hsl(var(--color-bg-surface))' };
  const wizardLine: CSSProperties = { width:'52px', height:'2px', background:'hsl(var(--color-border-subtle))' };
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

  const ghostBtn = btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))');
  const primaryBtn = btn(A, 'hsl(var(--color-fg-on-solid))', A);
  /* Canvas toolbar is icon-only at every width: the name of each tool is its
     `title` — the tooltip on hover — and its `aria-label`, never text beside
     the glyph. Spelling the labels out on a wide canvas made the toolbar read
     as a sentence of words rather than a row of tools, and moved every button
     as the rail was resized. */
  const sqBtn = (bg: string, fg: string, bd: string): CSSProperties =>
    Object.assign({}, btn(bg, fg, bd),
      { width:'32px', padding:'0', justifyContent:'center', fontSize:'.9375rem', fontWeight:500, flex:'0 0 auto' });
  const toolBtn = sqBtn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))');
  const alignStyle = toolBtn;
  const dangerStyle = sqBtn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-danger))', 'hsl(var(--color-border-danger))');
  const gridBtnStyle = sqBtn(s.grid ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))', s.grid ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-subtle))', s.grid ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))');
  const iconBtn: CSSProperties = { flex:'0 0 auto', width:'28px', height:'28px', borderRadius:'8px', border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))', cursor:'pointer', color:'hsl(var(--color-fg-subtle))', fontSize:'.8125rem', lineHeight:1 };
  const input = inputStyle;
  const textareaStyle: CSSProperties = { border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'9px', padding:'8px 10px', fontSize:'.78125rem', resize:'vertical', outline:'none', width:'100%', color:'hsl(var(--color-fg-default))' };

  /* ── recipient cards ── */
  /* The fields a recipient is actually being asked to fill in. The sender's own
     marks live in the same array (they are `Field` rows too) but counting them
     here would tell a sender "3 fields assigned" for three doodles nobody is
     asked to do anything with. */
  const inputFields = F.filter(f => !isAnnotationType(f.type));
  const recipientCards = R.map(r => {
    const on = s.activeRecipient === r.id;
    return {
      id: r.id,
      name: r.name, order: String(r.order), fieldCount: String(inputFields.filter(f => f.to === r.id).length), state: r.status,
      role: ROLE_LABEL[r.role],
      onClick: () => set({ activeRecipient: r.id }),
      style: { display:'flex', alignItems:'center', gap:'9px', padding:'9px', borderRadius:'11px', cursor:'pointer',
        border:'1px solid ' + (on ? r.color : 'hsl(var(--color-border-subtle))'), background: on ? r.color + '14' : 'hsl(var(--color-bg-surface))', width:'100%' } as CSSProperties,
      chip: { width:'26px', height:'26px', borderRadius:'8px', background:r.color, color:'hsl(var(--color-fg-on-solid))', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
      stateStyle: { marginLeft:'auto', fontSize:'.625rem', fontFamily:'var(--font-sans)', color:'hsl(var(--color-fg-muted))', whiteSpace:'nowrap' } as CSSProperties
    };
  });

  /* ── palette ── */
  const paletteTabs = ([['all','All fields'],['fav','Favourites']] as [string, string][]).map(([id, label]) => {
    const on = s.paletteTab === id;
    return { id, label, selected: on,
      onClick: () => set({ paletteTab: id }),
      style: { flex:'1', height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem', fontWeight: on ? 600 : 500,
        background: on ? 'hsl(var(--color-bg-surface))' : 'transparent', color: on ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });
  /* The pen is a mode, not a shape to drop: you pick it up and then draw. So
     its tile toggles `penMode` on both the pointer and the keyboard path
     instead of starting a drag — dragging a fixed-size "drawing" box onto the
     page would place an empty one nothing could ever be drawn into. */
  const togglePen = () => {
    const on = !s.penMode;
    set({ penMode: on, penStroke: null, dragTool: null, ghost: null });
    flash(on ? 'Pen on · drag across the page to draw. Press Esc to put it down.' : 'Pen put down');
  };
  /* The organization's choice comes first: a type it has turned off is not a
     tile you can reach by searching for it or by having starred it earlier. */
  const tools = TYPES.filter(t => fieldTypeEnabled(enabledTypes, t.id) &&
      (s.paletteTab === 'all' || s.favTypes.indexOf(t.id) > -1) &&
      (!s.paletteQuery || t.label.toLowerCase().indexOf(s.paletteQuery.toLowerCase()) > -1)).map(t => ({
    id: t.id, label: t.label, icon: t.icon, svg: t.svg,
    isPen: t.id === 'drawing',
    penOn: t.id === 'drawing' && s.penMode,
    // The button is operable by pointer *and* by keyboard: drag it onto the
    // page, or focus it and press Enter/Space to drop one in the middle of the
    // page ready to be nudged with the arrow keys (audit §8.9).
    aria: t.id === 'drawing'
      ? (s.penMode ? 'Put the pen down' : 'Pick the pen up and draw on the page')
      : 'Place ' + t.label + ' — drag onto the page, or press Enter to place it in the middle',
    onDown: (e: React.PointerEvent) => { if (t.id === 'drawing') return; I.onToolDown(t.id, e); },
    onPlace: () => { if (t.id === 'drawing') { togglePen(); return; } I.placeTool(t.id); },
    // Starring is per account, so the tab is the same palette on every device
    // the user signs in on. Disabled until the account's set has loaded, so a
    // toggle can never persist the seed as though it were a choice.
    favorite: isFavorite(t.id),
    favoriteDisabled: !favoritesReady,
    favoriteAria: (isFavorite(t.id) ? 'Remove ' : 'Add ') + t.label + (isFavorite(t.id) ? ' from' : ' to') + ' favourites',
    onToggleFavorite: () => toggleFavorite(t.id),
    // Every tile fills its grid cell, so the columns line up and the star --
    // absolutely positioned against the cell -- sits in the tile's own corner
    // rather than floating in the gap beside a content-width button.
    style: { display:'flex', alignItems:'center', gap:'7px', padding:'0 9px', width:'100%', height:'100%', minHeight:'44px', borderRadius:'10px',
      cursor: t.id === 'drawing' ? 'pointer' : 'grab', textAlign:'left',
      border:'1px solid ' + (s.dragTool === t.id || (t.id === 'drawing' && s.penMode) ? A : 'hsl(var(--color-border-subtle))'),
      background: s.dragTool === t.id || (t.id === 'drawing' && s.penMode) ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-subtle))', color:'hsl(var(--color-fg-subtle))' } as CSSProperties,
    glyph: { width:'20px', height:'20px', borderRadius:'6px', background:'hsl(var(--color-bg-muted))', display:'grid', placeItems:'center', fontSize:'.625rem', color:'hsl(var(--color-fg-subtle))', flex:'0 0 20px', fontFamily:'var(--font-sans)' } as CSSProperties
  }));

  /* ── page thumbs ── */
  const thumbs = pages.map(n => {
    const cnt = inputFields.filter(f => f.page === n).length;
    const on = s.page === n;
    return { n: String(n), key: n,
      onClick: () => { set({ page: n, selected: [] }); scrollToPage(n); },
      style: { position:'relative', display:'flex', alignItems:'center', gap:'10px', padding:'8px', borderRadius:'11px', width:'100%',
        border:'1px solid ' + (on ? A : 'hsl(var(--color-border-subtle))'), background: on ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))',
        cursor: pages.length > 1 && !pageBusy ? 'grab' : 'default',
        // The row being carried stays in place, dimmed, so the list it is being
        // dropped into does not jump around under the pointer.
        opacity: dragPage === n ? .45 : 1 } as CSSProperties,
      sheet: { width:'32px', height:'42px', background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'3px', display:'flex', flexDirection:'column', gap:'3px', padding:'5px', flex:'0 0 32px' } as CSSProperties,
      line1: { height:'2px', background:BORDER_STRONG, borderRadius:'2px' } as CSSProperties,
      line2: { height:'2px', background:'hsl(var(--color-border-subtle))', borderRadius:'2px', width:'80%' } as CSSProperties,
      line3: { height:'2px', background:'hsl(var(--color-border-subtle))', borderRadius:'2px', width:'60%' } as CSSProperties,
      badgeLabel: cnt ? cnt + ' fields' : 'no fields',
      badge: { fontSize:'.625rem', fontFamily:'var(--font-sans)', color: cnt ? 'hsl(var(--color-fg-success))' : TEXT_MUTED } as CSSProperties,
      /* Page-level edits, on the page they act on. Each is a document rewrite,
         so they are disabled while one is in flight and the first/last page
         cannot be moved past the ends of the document. */
      /* Dragging is only meaningful with somewhere to go, and never while a
         rewrite is in flight. */
      draggable: pages.length > 1 && !pageBusy,
      dragging: dragPage === n,
      /* The insertion line is drawn on the row the drop would land above, and
         on the last row's underside for a drop at the very end. */
      dropAbove: dropBefore === n && dragPage !== null && dragPage !== n && dragPage !== n - 1,
      dropBelowLast: n === pages.length && dropBefore === pages.length + 1 && dragPage !== null && dragPage !== n,
      onDragStart: onPageDragStart(n),
      onDragOver: onPageDragOver(n),
      onDrop: onPageDrop,
      onDragEnd: endPageDrag,
      dropLine: { position:'absolute', left:'6px', right:'6px', height:'2px', borderRadius:'2px', background:A } as CSSProperties,
      canUp: n > 1 && !pageBusy,
      canDown: n < pages.length && !pageBusy,
      canRemove: pages.length > 1 && !pageBusy,
      onUp: () => { void movePage(n, -1); },
      onDown: () => { void movePage(n, 1); },
      onRemove: () => { void removePage(n); },
      pageBtn: (enabled: boolean) => (Object.assign({
        width:'22px', height:'20px', borderRadius:'6px', border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))',
        fontSize:'.625rem', lineHeight:1, color:'hsl(var(--color-fg-subtle))', display:'grid', placeItems:'center',
      }, enabled ? { cursor:'pointer' } : { opacity:.4, cursor:'not-allowed' }) as CSSProperties),
      removeBtn: (enabled: boolean) => (Object.assign({
        width:'22px', height:'20px', borderRadius:'6px', border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))',
        fontSize:'.625rem', lineHeight:1, color:'hsl(var(--color-fg-danger))', display:'grid', placeItems:'center',
      }, enabled ? { cursor:'pointer' } : { opacity:.4, cursor:'not-allowed' }) as CSSProperties) };
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
    const extras = P.fieldExtras(f.id);
    const choices = fieldChoices(extras?.options ?? null);
    /* One button of a radio group (see `lib/sf/radioGroups.ts`): it draws as
       the single dot it is, wherever the sender has dragged it, rather than as
       a box listing the whole group. */
    const radio = f.type === 'radio' ? radioOptions(extras?.options ?? null) : null;
    const boxW = f.w * z, boxH = f.h * z;
    /* ── the sender's own marks (ANN-1) ──
       An annotation is drawn as the mark it *is*, not as a labelled field box:
       it is burned into the final PDF exactly like this, so the builder has to
       show it rather than describe it. It carries no recipient badge either —
       nobody is being asked to do anything with it. */
    const isAnn = isAnnotationType(f.type);
    const ink = f.type === 'drawing' ? drawingOptions(extras?.options ?? null) : null;
    const tbox = f.type === 'textbox' ? textboxOptions(extras?.options ?? null) : null;
    const tboxText = f.type === 'textbox' ? (extras?.defaultValue ?? '') : '';
    /* A radio group that cannot draw all of its choices in the box as sized is
       flagged here rather than discovered by the recipient. */
    const radioColumn = boxH >= 26 * Math.max(2, choices.length);
    const clipped = f.type === 'radio' && !radio && choices.length > 0
      && (radioColumn ? boxH < 20 * choices.length : boxW < 70 * choices.length);
    /* The dot is drawn inside the box, so a button sized right down to the
       print on the page still reads as a circle rather than as a border. */
    const dot = Math.max(6, Math.min(boxW, boxH) - 4);
    return {
      id: f.id,
      aria: (radio ? radio.groupLabel + ' — ' + radio.choice : t.label)
        + ' for ' + r.name + (f.required ? ', required' : ', optional')
        + ', at ' + f.x + ' by ' + f.y + ' points from the top-left of the page',
      selected: on,
      onDown: (e: React.PointerEvent) => I.onFieldDown(f.id, e),
      onResize: (e: React.PointerEvent) => I.onResizeDown(f.id, e),
      onKey: (e: React.KeyboardEvent) => { if (e.key === 'Enter') set({ selected: [f.id] }); },
      isAnn,
      ink, tbox, tboxText,
      strokePaths: ink ? ink.strokes.map(stroke => strokePath(stroke, boxW, boxH)) : [],
      inkWidth: ink ? Math.max(0.5, ink.stroke * z) : 0,
      viewBox: '0 0 ' + Math.max(1, boxW) + ' ' + Math.max(1, boxH),
      textStyle: tbox ? ({ width:'100%', height:'100%', overflow:'hidden', whiteSpace:'pre-wrap', wordBreak:'break-word',
        fontFamily: textboxFontStack(tbox.font), fontSize: (tbox.size * z) + 'px', lineHeight: 1.2,
        fontWeight: tbox.bold ? 700 : 400, fontStyle: tbox.italic ? 'italic' : 'normal', color: tbox.color } as CSSProperties) : null,
      emptyTextStyle: { fontSize:'.65625rem', color:TEXT_MUTED, fontStyle:'italic' } as CSSProperties,
      box: isAnn ? ({ position:'absolute', left:(f.x * z) + 'px', top:(f.y * z) + 'px', width:boxW + 'px', height:boxH + 'px',
        background:'transparent', border:'1px ' + (on ? 'solid' : 'dashed') + ' ' + (on ? A : 'rgba(148,163,184,.55)'),
        borderRadius:'4px', cursor:'grab', padding:'2px 3px', overflow:'hidden',
        // In pen mode the page below has to receive the gesture, or a stroke
        // could not be drawn across a mark already on it.
        pointerEvents: s.penMode ? 'none' : 'auto',
        boxShadow: on ? '0 0 0 2px hsl(var(--color-bg-surface)), 0 0 0 4px ' + A + '55' : 'none' } as CSSProperties)
      : { position:'absolute', left:(f.x * z) + 'px', top:(f.y * z) + 'px', width:(f.w * z) + 'px', height:(f.h * z) + 'px',
        background: r.color + '1f', border:'1.5px solid ' + r.color, borderRadius:'6px', cursor:'grab',
        pointerEvents: s.penMode ? 'none' : 'auto',
        boxShadow: on ? '0 0 0 2px hsl(var(--color-bg-surface)), 0 0 0 4px ' + r.color + '66' : 'none',
        display:'flex', alignItems:'center', justifyContent:'center', padding:'2px 6px',
        outline: clipped ? '1.5px dashed hsl(var(--color-fg-danger))' : 'none', outlineOffset: clipped ? '1px' : undefined } as CSSProperties,
      badge: { position:'absolute', top:'-9px', left:'-1px', height:'17px', padding:'0 6px', borderRadius:'5px', background:r.color,
        color:'hsl(var(--color-fg-on-solid))', fontSize:'.59375rem', fontWeight:700, display:'flex', alignItems:'center', gap:'4px', fontFamily:'var(--font-sans)', whiteSpace:'nowrap' } as CSSProperties,
      badgeText: initials(r.name) + ' · ' + (radio ? radio.choice : t.label)
        + (f.required ? ' *' : '') + (clipped ? ' · too small' : ''),
      label: f.label,
      inner: { fontSize: (f.w * z) < 110 ? '10px' : '11.5px', fontWeight:600, color:'hsl(var(--color-fg-default))', opacity:.75, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 } as CSSProperties,

      /* ── what the recipient sees, previewed ── */
      isCheck: f.type === 'checkbox',
      /** A radio field authored before groups existed: one box, every choice. */
      isRadio: f.type === 'radio' && !radio,
      /** One button of a group, or null. */
      radio,
      radioAria: radio
        ? radio.groupLabel + ' — ' + radio.choice + ' (' + (radio.choices.indexOf(radio.choice) + 1)
          + ' of ' + radio.choices.length + ') for ' + r.name
        : '',
      /** The sender pre-selected this button, so it is drawn filled. */
      radioOn: radio ? (extras?.defaultValue ?? '') === radio.choice : false,
      radioRing: { position:'absolute', inset:0, display:'grid', placeItems:'center', pointerEvents:'none' } as CSSProperties,
      radioCircle: { width:dot + 'px', height:dot + 'px', borderRadius:'99px', border:'1.5px solid ' + r.color,
        background:'hsl(var(--color-bg-surface))', display:'grid', placeItems:'center' } as CSSProperties,
      radioFill: { width: Math.max(3, dot * 0.5) + 'px', height: Math.max(3, dot * 0.5) + 'px',
        borderRadius:'99px', background:r.color } as CSSProperties,
      isSelect: f.type === 'dropdown',
      choices,
      /** The signing surface's own layout rule, so the preview agrees with it. */
      radioColumn,
      clipped,
      previewWrap: { position:'absolute', inset:0, padding:'2px 6px', display:'flex', alignItems:'center',
        overflow:'hidden', pointerEvents:'none' } as CSSProperties,
      radioWrap: { display:'flex', flexDirection: (radioColumn ? 'column' : 'row') as CSSProperties['flexDirection'],
        flexWrap:'wrap', gap:'2px 10px', width:'100%', height:'100%', alignContent:'center', overflow:'hidden' } as CSSProperties,
      radioRow: { display:'flex', alignItems:'center', gap:'5px', fontSize:'.71875rem', color:'hsl(var(--color-fg-default))', whiteSpace:'nowrap' } as CSSProperties,
      radioDot: { width:'11px', height:'11px', borderRadius:'99px', border:'1.5px solid ' + r.color, flex:'0 0 11px' } as CSSProperties,
      checkGlyph: { width:'100%', height:'100%', display:'grid', placeItems:'center', fontSize: Math.max(10, Math.min(22, boxH - 8)) + 'px',
        color: r.color, fontWeight:700 } as CSSProperties,
      selectRow: { display:'flex', alignItems:'center', justifyContent:'space-between', gap:'6px', width:'100%',
        fontSize:'.71875rem', color:'hsl(var(--color-fg-subtle))', whiteSpace:'nowrap', overflow:'hidden' } as CSSProperties,
      selectText: choices.length ? choices[0] : 'Select…',
      /** Warn where the signer would be stuck, in the sender's own view. */
      noChoices: CHOICE_TYPES.has(f.type) && !radio && choices.length === 0,
      warnStyle: { fontSize:'.625rem', color:'hsl(var(--color-fg-warning))', lineHeight:1.25, whiteSpace:'normal', overflow:'hidden' } as CSSProperties,
      handle: { position:'absolute', right:'-5px', bottom:'-5px', width:'11px', height:'11px', borderRadius:'3px', background:'hsl(var(--color-bg-surface))', border:'1.5px solid ' + r.color, cursor:'nwse-resize' } as CSSProperties
    };
  });

  /* ── the outline around a radio group ────────────────────────────────────
     A group is a set of freely placed fields (see `lib/sf/radioGroups.ts`), and
     each one draws as the single dot it is — which is right for the signer but
     left the sender no way to see which dots answer the same question. Three
     buttons of one group and three unrelated yes/no dots looked identical.

     So the group is outlined on the page: a faint dashed box around its members
     with the group's name on it, solid and tinted while a member is selected.
     It is drawn per page — a group whose buttons straddle a page break gets an
     outline on each — behind the fields and inert, so it never takes a gesture
     meant for a button. */
  const radioGroupBoxes = (pageNumber: number) => {
    const groups = new Map<string, { label: string; color: string; on: boolean;
      x1: number; y1: number; x2: number; y2: number }>();
    F.filter(f => f.page === pageNumber && f.type === 'radio').forEach(f => {
      const member = radioOptions(P.fieldExtras(f.id)?.options ?? null);
      if (!member) return;                       // a legacy single-box radio
      const found = groups.get(member.group);
      const on = s.selected.indexOf(f.id) > -1;
      if (!found) {
        groups.set(member.group, {
          label: member.groupLabel, color: recipIn(f.to).color, on,
          x1: f.x, y1: f.y, x2: f.x + f.w, y2: f.y + f.h,
        });
        return;
      }
      found.on = found.on || on;
      found.x1 = Math.min(found.x1, f.x);
      found.y1 = Math.min(found.y1, f.y);
      found.x2 = Math.max(found.x2, f.x + f.w);
      found.y2 = Math.max(found.y2, f.y + f.h);
    });
    /* Padding in CSS px rather than points: the outline is chrome for the
       sender, so it should look the same at every zoom. */
    const pad = 7;
    return Array.from(groups.entries()).map(([group, g]) => ({
      key: group,
      label: g.label,
      box: { position:'absolute', left:(g.x1 * z - pad) + 'px', top:(g.y1 * z - pad) + 'px',
        width:((g.x2 - g.x1) * z + pad * 2) + 'px', height:((g.y2 - g.y1) * z + pad * 2) + 'px',
        border:'1.5px ' + (g.on ? 'solid' : 'dashed') + ' ' + g.color + (g.on ? 'cc' : '66'),
        background: g.on ? g.color + '0f' : 'transparent',
        borderRadius:'8px', pointerEvents:'none', zIndex:0 } as CSSProperties,
      labelStyle: { position:'absolute', top:'-8px', left:'8px', padding:'0 5px', height:'16px',
        display:'flex', alignItems:'center', borderRadius:'4px', background:'hsl(var(--color-bg-surface))',
        border:'1px solid ' + g.color + (g.on ? 'cc' : '55'), color:g.color,
        fontSize:'.5625rem', fontWeight:700, whiteSpace:'nowrap', fontFamily:'var(--font-sans)' } as CSSProperties,
    }));
  };

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
  /* ── the selected radio group ──────────────────────────────────────────
     A radio group is a set of fields, one per button, tied together by their
     `options` (see `lib/sf/radioGroups.ts`). The inspector therefore edits the
     *group* even though a single button is what is selected on the page: the
     list below adds, renames, removes and pre-selects buttons, and the label,
     the recipient and `required` are applied to every member — a group whose
     buttons disagreed about who answers it, or about whether an answer is
     owed, is not a question anybody could answer. */
  const oneRadio = one && one.type === 'radio' ? radioOptions(oneExtras?.options ?? null) : null;
  const radioButtons = oneRadio
    ? radioGroupMembers(F, f => P.fieldExtras(f.id)?.options ?? null, oneRadio.group)
    : [];
  const radioChoices = radioButtons.map(m => m.options.choice);
  /** Write one member's `options`, keeping the group's list in step. */
  const writeRadio = (fieldId: string, patch: Partial<RadioOptions>, base: RadioOptions) => {
    P.setFieldExtras(fieldId, { apiType: 'radio', options: radioMemberOptions(Object.assign({}, base, patch)) });
  };
  /** Publish the group's list — and its name — onto every member. */
  const publishRadio = (choices: string[], groupLabel?: string) => {
    radioButtons.forEach(m => writeRadio(m.field.id, {
      choices,
      groupLabel: groupLabel ?? m.options.groupLabel,
      choice: m.options.choice,
    }, m.options));
  };
  /** The group's pre-selected button, stored as every member's default value. */
  const radioPreselected = oneExtras?.defaultValue ?? '';
  const setRadioPreselected = (choice: string) => {
    radioButtons.forEach(m => P.setFieldExtras(m.field.id, { defaultValue: choice ? choice : null }));
  };
  const [radioDraft, setRadioDraft] = React.useState<{ id: string; text: string } | null>(null);
  const renameRadio = (member: (typeof radioButtons)[number], text: string) => {
    setRadioDraft({ id: member.field.id, text });
    const next = text.trim();
    // An empty label is not a choice the API would accept, so it stays a draft
    // until there is something to name the button with.
    if (!next || (next !== member.options.choice && radioChoices.indexOf(next) > -1)) return;
    const choices = radioChoices.map(choice => (choice === member.options.choice ? next : choice));
    radioButtons.forEach(m => writeRadio(m.field.id, {
      choices,
      choice: m.field.id === member.field.id ? next : m.options.choice,
    }, m.options));
    if (radioPreselected === member.options.choice) setRadioPreselected(next);
  };
  const addRadioOption = () => {
    if (!oneRadio || !radioButtons.length) return;
    const choice = nextRadioChoice(radioChoices);
    const last = radioButtons[radioButtons.length - 1].field;
    const size = allPageSizes[last.page - 1] ?? null;
    const wanted = last.y + RADIO_PITCH;
    const id = 'f' + Date.now().toString().slice(-6);
    const nf: SFField = {
      id, page: last.page, type: 'radio', x: last.x,
      y: size ? Math.max(0, Math.min(wanted, size.height - last.h)) : wanted,
      w: last.w, h: last.h, to: last.to, required: last.required, readOnly: false,
      label: oneRadio.groupLabel, placeholder: '', validation: 'none', cond: last.cond,
    };
    const choices = radioChoices.concat([choice]);
    set(prev => ({ fields: prev.fields.concat([nf]), selected: [id] }));
    writeRadio(id, { choice, choices }, oneRadio);
    publishRadio(choices);
    flash(choice + ' added — drag it where it belongs on the page');
  };
  const removeRadioOption = (member: (typeof radioButtons)[number]) => {
    const rest = radioButtons.filter(m => m.field.id !== member.field.id);
    set(prev => ({
      fields: prev.fields.filter(f => f.id !== member.field.id),
      selected: rest.length ? [rest[0].field.id] : [],
    }));
    setRadioDraft(null);
    const choices = rest.map(m => m.options.choice);
    rest.forEach(m => writeRadio(m.field.id, { choices, choice: m.options.choice }, m.options));
    if (radioPreselected === member.options.choice) {
      rest.forEach(m => P.setFieldExtras(m.field.id, { defaultValue: null }));
    }
    flash(rest.length ? member.options.choice + ' removed' : 'Radio group removed');
  };
  /** A group-wide edit: every button answers for the same recipient, carries
   *  the same obligation and shows the same name. */
  const setRadioGroupField = (patch: Partial<SFField>) => {
    radioButtons.forEach(m => setField(m.field.id, patch));
    if (patch.label !== undefined) publishRadio(radioChoices, patch.label || 'Radio Group');
  };
  /** The smallest box this field may be given — a radio button is a dot, so it
   *  is allowed below the floor an input box needs (`onResizeDown` agrees). */
  const minSize = oneRadio ? { w: RADIO_MIN_SIZE, h: RADIO_MIN_SIZE } : { w: 32, h: 24 };
  /** A field edit that follows the whole group when a radio button is selected. */
  const editOne = (patch: Partial<SFField>) => {
    if (!one) return;
    if (oneRadio) { setRadioGroupField(patch); return; }
    setField(one.id, patch);
  };
  const wantsChoices = one ? CHOICE_TYPES.has(one.type) && !oneRadio : false;
  const wantsDefault = one ? DEFAULTABLE_TYPES.has(one.type) && !oneRadio : false;
  /* A dropdown's choices, one input per choice — the same editor shape as a
     radio group's buttons. They used to be one newline-separated textarea,
     which meant the sender was formatting a list rather than editing options:
     there was no way to rename one without retyping around it, no way to move
     one, and a stray blank line silently became nothing at all.

     A row is allowed to be empty while it is being typed — the empty entry is
     kept in the stored list so the row keeps its place, and dropped when the
     input is left. */
  const writeChoices = (list: string[]) => {
    if (!one) return;
    const kept = list.length ? list : [];
    P.setFieldExtras(one.id, { options: kept.length ? kept : null });
  };
  const renameChoice = (at: number, text: string) => {
    const next = oneChoices.slice();
    next[at] = text;
    writeChoices(next);
  };
  /** Drop the rows left blank, once the sender has moved on from them. */
  const settleChoices = () => {
    const kept = oneChoices.map(choice => choice.trim()).filter(choice => choice.length > 0);
    if (kept.length !== oneChoices.length || kept.some((choice, i) => choice !== oneChoices[i])) writeChoices(kept);
  };
  const addChoice = () => {
    /* "Option N", N unused, so a fresh row is never a duplicate of one that is
       already there — a dropdown with two identical options cannot be answered
       unambiguously. */
    let n = oneChoices.length + 1;
    while (oneChoices.indexOf('Option ' + n) > -1) n += 1;
    writeChoices(oneChoices.concat(['Option ' + n]));
  };
  const removeChoice = (at: number) => {
    const gone = oneChoices[at];
    writeChoices(oneChoices.filter((_, i) => i !== at));
    // A pre-selected value that no longer exists would be sent as an answer
    // the API rejects, so it goes with the option.
    if (one && (oneExtras?.defaultValue ?? '') === gone) P.setFieldExtras(one.id, { defaultValue: null });
  };
  const moveChoice = (at: number, dir: number) => {
    const to = at + dir;
    if (to < 0 || to >= oneChoices.length) return;
    const next = oneChoices.slice();
    const [moved] = next.splice(at, 1);
    next.splice(to, 0, moved);
    writeChoices(next);
  };
  const editDefault = (value: string) => {
    if (!one) return;
    P.setFieldExtras(one.id, { defaultValue: value ? value : null });
  };

  /* ── the selected annotation (ANN-1) ──
     A pen drawing and a text box are the sender's own marks, so the inspector
     shows what actually governs them — the face, the size, the ink — and hides
     everything that only means something for a field a recipient fills in:
     required, read-only, validation, conditional logic and the placeholder all
     describe an obligation an annotation does not carry. */
  const oneIsAnn = one ? isAnnotationType(one.type) : false;
  const oneTextbox = one && one.type === 'textbox' ? textboxOptions(oneExtras?.options ?? null) : null;
  const oneDrawing = one && one.type === 'drawing' ? drawingOptions(oneExtras?.options ?? null) : null;
  const editTextbox = (patch: Partial<NonNullable<typeof oneTextbox>>) => {
    if (!one || !oneTextbox) return;
    P.setFieldExtras(one.id, { options: Object.assign({}, oneTextbox, patch) });
  };
  const editDrawing = (patch: { color?: string; stroke?: number }) => {
    if (!one || !oneDrawing) return;
    P.setFieldExtras(one.id, { options: Object.assign({}, oneDrawing, patch) });
  };
  /* PAY-1: the selected payment field's own amount/currency/memo, per-field —
     the envelope-level split (who owes what) is a separate panel below,
     since it spans every payment field on the document rather than just this
     one. */
  const onePayment = one && one.type === 'payment' ? paymentFieldOptions(oneExtras?.options ?? null) : null;
  const editPayment = (patch: Partial<ReturnType<typeof paymentFieldOptions>>) => {
    if (!one || !onePayment) return;
    P.setFieldExtras(one.id, { options: Object.assign({}, onePayment, patch) });
  };
  /* The text is edited as free text — a trailing newline has to survive the
     keystroke that made it — so, like the choices box, the draft is what is
     shown and the trimmed value is what is stored. */
  const annText = oneExtras?.defaultValue ?? '';
  /* A type that *is* a format validates as that format even with Validation
     left at "None" — `field_service.effective_validation` on the backend and
     `effectiveValidation` on the signing surface both imply it. Saying "no
     pattern enforced" here would be a lie the signer discovers instead. */
  const impliedValidation = one && (one.validation || 'none') === 'none'
    ? effectiveValidation({ type: one.type, validation: 'none' }).replace('none', '')
    : '';
  const condOptions = F.filter(f => one && f.id !== one.id && f.page === (one ? one.page : 1))
    .map(f => ({ id: f.id, label: f.label + ' (' + meta(f.type).label + ')' }));
  const cond = one && one.cond ? one.cond : { field:'', op:'checked', value:'' };
  const condTrigger = cond.field ? F.find(f => f.id === cond.field) : null;
  const condSummary = condTrigger
    ? 'Show “' + (one ? one.label : '') + '” only when “' + condTrigger.label + '” ' +
      (cond.op === 'equals' ? 'equals “' + cond.value + '”' : COND_OP_LABEL[cond.op]) + '.'
    : 'Always visible to the assigned recipient.';
  const condSummaryStyle: CSSProperties = { fontSize:'.71875rem', color: condTrigger ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-muted))', background: condTrigger ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-canvas))', border:'1px solid ' + (condTrigger ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))'), borderRadius:'8px', padding:'8px 9px', lineHeight:1.5 };
  const inspIcon: CSSProperties = { width:'30px', height:'30px', borderRadius:'9px', background: one ? recipIn(one.to).color : 'hsl(var(--color-border-subtle))', color:'hsl(var(--color-fg-on-solid))', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, fontFamily:'var(--font-sans)' };
  const regexBox: CSSProperties = { fontFamily:'var(--font-sans)', fontSize:'.65625rem', color:'hsl(var(--color-fg-subtle))', background:'hsl(var(--color-bg-canvas))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'8px', padding:'8px 9px', wordBreak:'break-all' };
  const rowBtn: CSSProperties = { display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', background:'transparent', border:'none', cursor:'pointer', padding:'2px 0' };
  const reqSwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: one && one.required ? 'hsl(var(--color-highlight-solid))' : BORDER_STRONG, position:'relative', transition:'background .15s' };
  const reqKnob: CSSProperties = { position:'absolute', top:'2px', left: one && one.required ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'hsl(var(--color-bg-surface))', transition:'left .15s' };
  const roSwitch: CSSProperties = { width:'34px', height:'19px', borderRadius:'99px', background: one && one.readOnly ? A : BORDER_STRONG, position:'relative' };
  const roKnob: CSSProperties = { position:'absolute', top:'2px', left: one && one.readOnly ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'hsl(var(--color-bg-surface))' };
  /** The up/down arrows beside a dropdown choice — small, and plainly inert at the ends. */
  const choiceMoveBtn = (enabled: boolean): CSSProperties => Object.assign({
    width:'22px', height:'14px', borderRadius:'5px', border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))',
    fontSize:'.5rem', lineHeight:1, color:'hsl(var(--color-fg-subtle))', display:'grid', placeItems:'center', padding:0,
  }, enabled ? { cursor:'pointer' } : { opacity:.4, cursor:'not-allowed' });
  /* While the envelope is still being prepared every recipient reads `Pending`,
     which says nothing — so the status rides along only once it has moved on. */
  const recipientOptions = R.map(r => ({
    id: r.id, label: r.status === 'Pending' ? r.name : r.name + ' — ' + r.status,
  }));

  /* ── the selected field's own toolbar, on the page ───────────────────────
     The inspector rail is still the full authoring surface, but the handful of
     things a sender does over and over — reassign this field, make another one
     like it, throw it away — were a trip across the screen from the field they
     apply to. So the selected field carries them itself: the bar floats just
     off its edge, the way it does in the tools senders already know.
     Everything else stays in the rail, one "Edit" away. */
  const inspectorFocusRef = React.useRef<HTMLInputElement | null>(null);
  const focusInspector = React.useCallback(() => {
    const el = inspectorFocusRef.current;
    if (!el) return;
    // Guarded: the rail is scrolled into view where the environment can, but
    // focus is the part that matters and must not depend on it.
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    el.focus();
    el.select();
  }, []);
  /* The bar is chrome, not part of the field: a press on it must not start the
     field's drag or the sheet's marquee. The grip is the deliberate exception
     — it hands the gesture straight to the field, so the bar can be dragged. */
  const stopDown = (e: React.PointerEvent) => { e.stopPropagation(); };
  const toolbarBtn: CSSProperties = { display:'grid', placeItems:'center', width:'26px', height:'26px', borderRadius:'7px',
    border:'1px solid transparent', background:'transparent', cursor:'pointer', color:'hsl(var(--color-fg-subtle))', fontSize:'.8125rem', lineHeight:1 };
  const toolbarDanger: CSSProperties = Object.assign({}, toolbarBtn, { color:'hsl(var(--color-fg-danger))' });
  const fieldToolbar = one && !s.penMode ? {
    id: one.id,
    page: one.page,
    isAnn: oneIsAnn,
    to: one.to,
    typeLabel: meta(one.type).label,
    color: recipIn(one.to).color,
    /* Above the field, unless it sits too near the top of the page for the bar
       to fit — then below it, so the bar is never clipped off the sheet. */
    wrap: Object.assign({
      position:'absolute',
      left:(one.x * z) + 'px',
      display:'flex', alignItems:'center', gap:'1px', zIndex:6,
      background:'hsl(var(--color-bg-surface))', border:'1px solid ' + BORDER_STRONG, borderRadius:'9px',
      boxShadow:'0 8px 20px rgba(15,23,42,.18)', padding:'3px 4px', whiteSpace:'nowrap',
      fontFamily:'var(--font-sans)',
    }, one.y * z >= 42
      ? { top:(one.y * z - 37) + 'px' }
      : { top:(one.y * z + one.h * z + 9) + 'px' }) as CSSProperties,
    gripStyle: { display:'grid', placeItems:'center', width:'20px', height:'26px', cursor:'grab', color:BORDER_STRONG, fontSize:'.75rem' } as CSSProperties,
    dotStyle: { width:'9px', height:'9px', borderRadius:'99px', background:recipIn(one.to).color, flex:'0 0 9px' } as CSSProperties,
    selectStyle: { height:'26px', maxWidth:'168px', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'7px', background:'hsl(var(--color-bg-surface))',
      fontSize:'.71875rem', color:'hsl(var(--color-fg-default))', padding:'0 4px', cursor:'pointer', outline:'none' } as CSSProperties,
    dividerStyle: { width:'1px', height:'18px', background:'hsl(var(--color-border-subtle))', margin:'0 2px' } as CSSProperties,
    annNoteStyle: { fontSize:'.6875rem', color:TEXT_MUTED, padding:'0 6px' } as CSSProperties,
    onGrip: (e: React.PointerEvent) => I.onFieldDown(one.id, e),
    onReassign: (e: React.ChangeEvent<HTMLSelectElement>) => setField(one.id, { to: e.target.value }),
    onEdit: focusInspector,
    onDuplicate: I.duplicateSel,
    /* Only worth offering where there is another page to copy onto. */
    canCopyAll: pages.length > 1,
    onCopyAll: I.copyToAllPages,
    onDelete: I.deleteSel,
  } : null;

  /* ── step 2: routing / send setup ── */
  const routingRows = R.map(r => ({
    id: r.id,
    name: r.name, email: r.email, role: r.role, order: s.routing === 'parallel' ? '=' : String(r.order), status: r.status,
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px', border:'1px solid hsl(var(--color-border-hairline))', borderRadius:'12px', background:'hsl(var(--color-bg-subtle))' } as CSSProperties,
    orderStyle: { width:'26px', height:'26px', borderRadius:'8px', background:r.color, color:'hsl(var(--color-fg-on-solid))', display:'grid', placeItems:'center', fontSize:'.71875rem', fontWeight:700, flex:'0 0 26px' } as CSSProperties,
    selectStyle: Object.assign({}, inputStyle, { width:'160px' }) as CSSProperties,
    onRole: (e: React.ChangeEvent<HTMLSelectElement>) => changeRole(r.id, e.target.value),
    onUp: () => reorderRecipient(r.id, -1),
    onDown: () => reorderRecipient(r.id, 1),
    onRemove: () => { void removeRecipient(r.id); }
  }));
  const cadences = ['24h','48h','7 days','none'].map(c => ({
    id: c, label: c === 'none' ? 'No reminders' : 'Every ' + c, onClick: () => changeRouting({ cadence: c }),
    style: btn(s.cadence === c ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))', s.cadence === c ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-subtle))', s.cadence === c ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))')
  }));
  const routeNote = s.routing === 'sequential'
    ? 'Each recipient is notified only after the previous one completes. Signer 1 → Signer 2 → Signer 3.'
    : 'All recipients are notified simultaneously and may sign in any order.';
  const routeNoteStyle: CSSProperties = { fontSize:'.75rem', color:'hsl(var(--color-accent-fg))', background:'hsl(var(--color-accent-subtle))', border:'1px solid hsl(var(--color-accent-border))', borderRadius:'10px', padding:'10px 11px', lineHeight:1.55 };
  const seqStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'.78125rem', fontWeight: s.routing === 'sequential' ? 600 : 500, background: s.routing === 'sequential' ? 'hsl(var(--color-bg-surface))' : 'transparent', color: s.routing === 'sequential' ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))', boxShadow: s.routing === 'sequential' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const parStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'.78125rem', fontWeight: s.routing === 'parallel' ? 600 : 500, background: s.routing === 'parallel' ? 'hsl(var(--color-bg-surface))' : 'transparent', color: s.routing === 'parallel' ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))', boxShadow: s.routing === 'parallel' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  /* The pre-send checklist, read off the real field set. `document_service.
     validate_for_send` is the authority — a failure there comes back as the
     400 the send call surfaces — so these are advisory. */
  const recipientIds = R.map(r => r.id);
  const orphanFields = F.filter(f => recipientIds.indexOf(f.to) < 0);
  const sendChecks = ([
    [inputFields.length + (inputFields.length === 1 ? ' field assigned' : ' fields assigned'),
      orphanFields.length
        ? orphanFields.length + ' field(s) have no recipient on this envelope'
        : 'Every required field has a recipient',
      orphanFields.length ? '#f59e0b' : '#10b981'],
    // FALLBACK: the consent disclosure version is not exposed by any endpoint.
    ['Disclosure attached', 'ESIGN consent shown before signing', '#10b981'],
    ['Certificate enabled', 'Sealed PDF and audit trail on completion', '#10b981']
  ] as [string, string, string][]).map(([label, metaText, c]) => ({
    label, meta: metaText,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background:c, marginTop:'5px', flex:'0 0 8px' } as CSSProperties
  }));

  /* ── PAY-1: the envelope's payment request ────────────────────────────────
     One `PaymentRequest` per document, split across one or more signing
     recipients. `signer_payment_service.sync_request` is the authority on
     every rule enforced here — this only mirrors it so a sender learns about
     a refusal before Save, not after a 400. */
  const [paymentAccount, setPaymentAccount] = React.useState<PaymentAccountResponse | null | undefined>(undefined);
  const [paymentRequest, setPaymentRequest] = React.useState<PaymentRequestResponse | null | undefined>(undefined);
  const [paymentSaving, setPaymentSaving] = React.useState(false);
  const [paymentDraft, setPaymentDraft] = React.useState<{
    total: string; currency: string; memo: string; splitMode: PaymentSplitMode;
    payerIds: string[]; customAmounts: Record<string, string>;
  }>({ total: '', currency: 'USD', memo: '', splitMode: 'single', payerIds: [], customAmounts: {} });

  /* The envelope-level payment panel (in the "Set up and send" step) is the
     only place these load lazily for — mark it open the first time the
     sender reaches that step, so an envelope with no payment field never
     pays for the two round trips below. */
  const [paymentPanelOpen, setPaymentPanelOpen] = React.useState(false);
  React.useEffect(() => {
    if (s.wizardStep === 2) setPaymentPanelOpen(true);
  }, [s.wizardStep]);
  const hasPaymentField = F.some(f => f.type === 'payment');

  /* Fetched at most once per document — guarded by this ref rather than by
     narrowing the effect's own re-run conditions, so a background refetch
     never clobbers a running draft while the sender is mid-edit. */
  const paymentFetchedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!documentId) return;
    if (!hasPaymentField && !paymentPanelOpen) return;
    if (paymentFetchedRef.current === documentId) return;
    paymentFetchedRef.current = documentId;
    let live = true;
    void paymentsApi.account(apiCall).then(res => { if (live) setPaymentAccount(res.ok ? res.data : null); });
    void paymentsApi.paymentRequest(apiCall, documentId).then(res => {
      if (!live) return;
      const data = res.ok ? res.data : null;
      setPaymentRequest(data);
      if (data) {
        const payerFields = F.filter(f => f.type === 'payment'
          && paymentFieldOptions(P.fieldExtras(f.id)?.options ?? null).payment_request_id === data.id);
        setPaymentDraft({
          total: amountInputFromCents(data.total_cents),
          currency: data.currency,
          memo: data.memo ?? '',
          splitMode: data.split_mode,
          payerIds: payerFields.map(f => f.to),
          customAmounts: Object.fromEntries(payerFields.map(f =>
            [f.to, amountInputFromCents(paymentFieldOptions(P.fieldExtras(f.id)?.options ?? null).amount_cents)])),
        });
      }
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, hasPaymentField, paymentPanelOpen]);

  const payableRecipients = R.filter(r => r.role !== 'copy');
  const paymentFieldFor = (recipientId: string): SFField | null =>
    F.find(f => f.type === 'payment' && f.to === recipientId) || null;
  /** The panel's one-click way out of the dead end where a payer cannot be
   *  selected because nobody has dragged a payment field onto the canvas yet.
   *  This creates the exact same `SFField` shape `useBuilderInteractions`'s own
   *  drop handler does — same type, same palette default size — so the result
   *  is indistinguishable from a dragged field and is picked up by the same
   *  autosave. Successive auto-placements are staggered so two payers never
   *  land on top of one another. */
  const placePaymentField = (recipientId: string) => {
    const paymentType = TYPES.find(t => t.id === 'payment');
    const w = paymentType ? paymentType.w : 160;
    const h = paymentType ? paymentType.h : 48;
    const already = F.filter(f => f.type === 'payment').length;
    const stagger = (already % 6) * 24;
    const id = 'f' + Date.now().toString().slice(-6) + already;
    const nf: SFField = {
      id, page: 1, type: 'payment', x: 40 + stagger, y: 40 + stagger, w, h,
      // Required, not optional: the settlement gate only looks at required
      // payment fields, so an optional one would let a signer who owes money
      // sign without paying. `sync_request` also forces this server-side.
      to: recipientId, required: true, readOnly: false,
      label: paymentType ? paymentType.label : 'Payment', placeholder: '',
      validation: 'none', cond: null,
    };
    set(prev => ({ fields: prev.fields.concat([nf]), selected: [id] }));
    flash((recipIn(recipientId).name || 'Recipient') + '’s payment field added to page 1 — drag it in the builder to reposition');
  };
  const paymentTotalCents = centsFromAmountInput(paymentDraft.total) ?? 0;
  const paymentEqualAmounts = splitEqualCents(paymentTotalCents, paymentDraft.payerIds.length);
  const paymentNoStripe = paymentAccount === null || (!!paymentAccount && !paymentAccount.charges_enabled);

  /** Resolved allocations for the current draft, in the shape the API wants. */
  const paymentAllocations = (): PaymentAllocationInput[] => {
    if (paymentDraft.splitMode === 'single') {
      return paymentDraft.payerIds.slice(0, 1).map(id => ({ recipient_id: id, amount_cents: paymentTotalCents }));
    }
    if (paymentDraft.splitMode === 'equal') {
      return paymentDraft.payerIds.map((id, i) => ({ recipient_id: id, amount_cents: paymentEqualAmounts[i] ?? 0 }));
    }
    return paymentDraft.payerIds.map(id => ({
      recipient_id: id, amount_cents: centsFromAmountInput(paymentDraft.customAmounts[id] ?? '') ?? 0,
    }));
  };

  /** Every reason Save is refused, mirroring `validate_allocations` /
   *  `sync_request` — surfaced in the panel rather than discovered as a 400. */
  const paymentErrors = (): string[] => {
    const errs: string[] = [];
    if (paymentTotalCents <= 0) errs.push('Enter a total amount greater than zero.');
    if (!paymentDraft.payerIds.length) errs.push('Select at least one recipient to pay.');
    if (paymentDraft.splitMode === 'single' && paymentDraft.payerIds.length > 1) {
      errs.push('A single-payer split needs exactly one recipient.');
    }
    const missingField = paymentDraft.payerIds.filter(id => !paymentFieldFor(id));
    if (missingField.length) {
      const names = missingField.map(id => (R.find(r => r.id === id) || {}).name || id).join(', ');
      errs.push('Place a payment field for ' + names + ' before allocating an amount to them.');
    }
    const allocations = paymentAllocations();
    if (paymentDraft.splitMode === 'custom') {
      const sum = allocations.reduce((total, a) => total + a.amount_cents, 0);
      if (sum !== paymentTotalCents) {
        errs.push('Custom allocations sum to ' + amountInputFromCents(sum)
          + ', which must equal the total of ' + amountInputFromCents(paymentTotalCents) + '.');
      }
    }
    allocations.forEach(a => {
      if (a.amount_cents > 0 && a.amount_cents < STRIPE_MINIMUM_CHARGE_CENTS) {
        const name = (R.find(r => r.id === a.recipient_id) || {}).name || a.recipient_id;
        errs.push(name + '’s allocation is below the $0.50 minimum Stripe can charge.');
      }
    });
    if (paymentNoStripe) {
      errs.push('Connect a Stripe account with charges enabled before this envelope can collect payment — see Payments under your account.');
    }
    return errs;
  };
  const paymentValidation = paymentErrors();

  /** Toggling a recipient in/out of the payer set. A single-payer split
   *  replaces the selection outright — there is only ever room for one. */
  const togglePaymentPayer = (id: string) => {
    setPaymentDraft(prev => {
      if (prev.splitMode === 'single') return Object.assign({}, prev, { payerIds: [id] });
      const has = prev.payerIds.indexOf(id) > -1;
      const payerIds = has ? prev.payerIds.filter(x => x !== id) : prev.payerIds.concat([id]);
      return Object.assign({}, prev, { payerIds });
    });
  };
  const setPaymentCustomAmount = (id: string, value: string) => {
    setPaymentDraft(prev => Object.assign({}, prev, { customAmounts: Object.assign({}, prev.customAmounts, { [id]: value }) }));
  };
  const setPaymentSplitMode = (mode: PaymentSplitMode) => {
    setPaymentDraft(prev => Object.assign({}, prev, { splitMode: mode, payerIds: mode === 'single' ? prev.payerIds.slice(0, 1) : prev.payerIds }));
  };
  const savePaymentRequest = async () => {
    if (!documentId || paymentValidation.length) return;
    setPaymentSaving(true);
    const res = await paymentsApi.setPaymentRequest(apiCall, documentId, {
      total_cents: paymentTotalCents,
      currency: paymentDraft.currency,
      memo: paymentDraft.memo || null,
      split_mode: paymentDraft.splitMode,
      allocations: paymentAllocations(),
    });
    setPaymentSaving(false);
    if (!res.ok) { flash(errorMessage(res) || 'Could not save the payment request'); return; }
    setPaymentRequest(res.data);
    flash('Payment request saved');
  };

  /* A fresh tenant has no draft to open, and `?document=` can name a document
     that has been deleted or belongs to another tenant (the API answers 404). */
  if (!documentId) {
    return (
      <section data-screen-label="Builder" style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0, background:'hsl(var(--color-bg-muted))' }}>
        <div style={{ flex:'0 0 auto', height:'52px', display:'flex', alignItems:'center', gap:'14px', padding:'0 16px', background:'hsl(var(--color-bg-surface))', borderBottom:'1px solid hsl(var(--color-border-subtle))' }}>
          <PdfBadge size={24} />
          <span style={{ fontSize:'.8125rem', fontWeight:600 }}>Prepare document</span>
        </div>
        <div style={{ flex:1, minHeight:0, display:'grid', placeItems:'center', padding:'26px' }}>
          <div style={{ maxWidth:'420px', background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'22px', display:'flex', flexDirection:'column', gap:'10px', textAlign:'center' }}>
            <span style={{ fontSize:'.84375rem', fontWeight:600, color:'hsl(var(--color-fg-default))' }}>No document to prepare</span>
            <span style={{ fontSize:'.75rem', lineHeight:1.6, color:'hsl(var(--color-fg-muted))' }}>Pick a PDF and we will create the draft for it, then open it here to place fields and assign recipients.</span>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'8px' }}>
              <UploadDocument label="Upload a file" />
              <button type="button" onClick={() => go('dashboard')} style={Object.assign({}, ghostBtn, { justifyContent:'center' })}><Icon name="documents" size={13} />Go to documents</button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* ── catalog round-trip ─────────────────────────────────────────────────
     This template is a platform curator's draft of a catalog form. The fields
     they drag here are the blueprint every tenant will import, so the banner
     gives them the one action the builder itself has no concept of: writing
     the placement back to the catalog entry. Tenants who already imported the
     form keep their own copy — an import is a copy, not a link. */
  /* Saving as a template copies the envelope — fields, recipient roles and
     routing — into the tenant's template library and leaves this draft alone,
     so the sender can keep preparing and still send it. */
  const saveAsTemplate = () => {
    if (!documentId || savingTemplate) return;
    void askText({
      title: 'Save as template',
      label: 'Template name',
      defaultValue: docTitle + ' (Template)',
      cta: 'Save template',
      required: true,
    }).then(name => {
      if (!name) return;
      setSavingTemplate(true);
      return documentsApi.makeTemplate(apiCall, documentId, name).then(res => {
        setSavingTemplate(false);
        flash(res.ok
          ? name + ' saved to your templates'
          : errorMessage(res) || 'Could not save this document as a template');
      });
    });
  };

  const saveToCatalog = () => {
    if (!documentId || !catalogSlug) return;
    setSavingCatalog(true);
    void platformCatalogApi.adopt(apiCall, catalogSlug, documentId).then(res => {
      setSavingCatalog(false);
      flash(res.ok
        ? 'Saved to the catalog — future imports use this placement'
        : 'Could not save to the catalog · ' + res.error.message);
    });
  };

  return (
    <section data-screen-label="Builder" style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>
      {catalogSlug ? (
        <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', padding:'9px 16px', background:'hsl(var(--color-accent-subtle))', borderBottom:'1px solid hsl(var(--color-accent-border))' }}>
          <span style={{ fontSize:'.78125rem', fontWeight:600, color:'hsl(var(--color-accent-fg))' }}>
            Catalog form · {catalogSlug}
          </span>
          <span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-info))', fontFamily:'var(--font-sans)' }}>
            Place the fields every tenant should get, then save them back to the catalog.
          </span>
          <button
            type="button"
            onClick={saveToCatalog}
            disabled={savingCatalog}
            style={{ ...btn(A, 'hsl(var(--color-fg-on-solid))', A), marginLeft:'auto', opacity: savingCatalog ? 0.6 : 1 }}
          ><Icon name="save" size={13} />{savingCatalog ? 'Saving…' : 'Save to catalog'}</button>
        </div>
      ) : null}
      <div style={{ flex:'0 0 auto', height:'52px', display:'flex', alignItems:'center', gap:'14px', padding:'0 16px', background:'hsl(var(--color-bg-surface))', borderBottom:'1px solid hsl(var(--color-border-subtle))' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', minWidth:0 }}>
          <PdfBadge size={24} />
          {renaming ? (
            <input
              type="text" autoFocus aria-label="Document name" value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              }}
              style={{ fontSize:'.8125rem', fontWeight:600, fontFamily:'inherit', color:'hsl(var(--color-fg-default))', padding:'3px 7px', borderRadius:'7px', border:'1px solid ' + A, outline:'none', minWidth:0, width:'260px', maxWidth:'40vw' }}
            />
          ) : (
            <button type="button" onClick={startRename} title="Rename document" aria-label={'Rename document · ' + docTitle}
              style={{ display:'flex', alignItems:'center', gap:'6px', background:'none', border:'none', padding:'0', cursor:'pointer', minWidth:0, font:'inherit' }}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{docTitle}</span>
              <span aria-hidden="true" style={{ color:TEXT_MUTED, flex:'0 0 auto' }}><Icon name="pencil" size={12} /></span>
            </button>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', margin:'0 auto' }}>
          <button type="button" onClick={goStep1} style={wizardStepStyle1}><span style={wizardDot1}></span>Prepare</button>
          <span style={wizardLine}></span>
          <button type="button" onClick={goStep2} style={wizardStepStyle2}><span style={wizardDot2}></span>Set up and send</button>
        </div>
        <div style={{ display:'flex', gap:'8px', flex:'0 0 auto' }}>
          {previewHref ? (
            <Link href={previewHref} style={{ ...ghostBtn, textDecoration:'none' }}><Icon name="eye" size={13} />Preview</Link>
          ) : null}
          {isTemplate ? null : (
            <button type="button" onClick={saveAsTemplate} disabled={savingTemplate} style={{ ...ghostBtn, opacity: savingTemplate ? 0.6 : 1 }}>
              <Icon name="documents" size={13} />{savingTemplate ? 'Saving…' : 'Save as template'}
            </button>
          )}
          <button type="button" onClick={saveClose} style={ghostBtn}><Icon name="save" size={13} />Save and close</button>
          <button type="button" onClick={wizardNext} style={primaryBtn}><Icon name="arrowRight" size={13} />{wizardCta}</button>
        </div>
      </div>

      <div style={prepareRowStyle}>

        <ResizableRail
          side="left" storageKey="sf.builder.rail.left" label="Prepare tools"
          defaultWidth={320} min={250} max={520}
          contentStyle={{ padding:'14px', display:'flex', flexDirection:'column', gap:'18px' }}
        >
          <div>
            <div style={railHead}>Recipients</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px', marginTop:'9px' }}>
              {recipientCards.map(r => (
                <button key={r.id} type="button" onClick={r.onClick} style={r.style}>
                  <span style={r.chip}>{r.order}</span>
                  <span style={{ display:'flex', flexDirection:'column', lineHeight:1.25, textAlign:'left', minWidth:0 }}>
                    <span style={{ fontSize:'.78125rem', fontWeight:600, color:'hsl(var(--color-fg-default))', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</span>
                    <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.role} · {r.fieldCount} fields</span>
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
            <div style={{ display:'flex', gap:'4px', background:'hsl(var(--color-bg-canvas))', padding:'4px', borderRadius:'9px', marginTop:'8px' }}>
              {paletteTabs.map(t => (
                <button key={t.id} type="button" onClick={t.onClick} aria-pressed={t.selected} style={t.style}>{t.label}</button>
              ))}
            </div>
            <input type="search" value={s.paletteQuery} onChange={e => set({ paletteQuery: e.target.value })} placeholder="Search fields" aria-label="Search fields" style={{ marginTop:'7px', height:'30px', width:'100%', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'9px', padding:'0 10px', fontSize:'.75rem', outline:'none', background:'hsl(var(--color-bg-subtle))' }} />
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(118px, 1fr))', gridAutoRows:'44px', gap:'7px', marginTop:'9px' }}>
              {tools.map(t => (
                /* The star sits beside the tile rather than inside it: the tile
                   is a button, and a button cannot contain another one. */
                <div key={t.id} style={{ position:'relative', height:'100%' }}>
                  <button type="button" onPointerDown={t.onDown} onClick={t.onPlace} aria-label={t.aria}
                    aria-pressed={t.isPen ? t.penOn : undefined} style={t.style}>
                    <span style={t.glyph}>{t.svg ? <Icon name={t.svg} size={13} /> : t.icon}</span>
                    <span style={{ fontSize:'.71875rem', fontWeight:500, lineHeight:1.2, minWidth:0, paddingRight:'12px' }}>{t.label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={t.onToggleFavorite}
                    disabled={t.favoriteDisabled}
                    aria-pressed={t.favorite}
                    aria-label={t.favoriteAria}
                    title={t.favoriteAria}
                    style={{ position:'absolute', top:'2px', right:'2px', width:'18px', height:'18px', display:'grid', placeItems:'center',
                      border:'none', background:'transparent', padding:0, borderRadius:'5px', lineHeight:1, fontSize:'.6875rem',
                      cursor: t.favoriteDisabled ? 'default' : 'pointer', color: t.favorite ? 'hsl(var(--color-fg-warning))' : BORDER_STRONG }}
                  >
                    <Icon name="star" size={13} solid={t.favorite} />
                  </button>
                </div>
              ))}
            </div>
            {/* An empty Favourites tab reads as a broken palette unless it says
                why it is empty. */}
            {s.paletteTab === 'fav' && tools.length === 0 && !s.paletteQuery ? (
              <p style={{ fontSize:'.71875rem', lineHeight:1.55, color:TEXT_MUTED, marginTop:'9px' }}>
                No favourites yet. Star a field on the All fields tab to keep it here.
              </p>
            ) : null}
            {/* The nib, shown only while the pen is up — a colour and a width
                picker that is permanently on screen would be four controls that
                do nothing most of the time. */}
            {s.penMode ? (
              <div style={{ marginTop:'10px', border:'1px solid hsl(var(--color-accent-border))', background:'hsl(var(--color-accent-subtle))', borderRadius:'11px', padding:'10px', display:'flex', flexDirection:'column', gap:'9px' }}>
                <div style={{ fontSize:'.71875rem', fontWeight:600, color:'hsl(var(--color-accent-fg))' }}>Pen is up — drag on the page to draw</div>
                <div role="group" aria-label="Pen colour" style={{ display:'flex', gap:'6px' }}>
                  {INK_COLORS.map(c => (
                    <button
                      key={c} type="button" onClick={() => set({ penInk: c })}
                      aria-label={'Pen colour ' + c} aria-pressed={s.penInk === c} title={c}
                      style={{ width:'22px', height:'22px', borderRadius:'7px', background:c, cursor:'pointer',
                        border:'2px solid ' + (s.penInk === c ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-bg-surface))'), boxShadow:'0 0 0 1px ' + BORDER_STRONG }}
                    />
                  ))}
                  {/* The five presets cover the inks a sender reaches for; the
                      picker is for the fifth colour they need — a brand ink, or
                      a highlighter that has to match the printed form. It sits
                      in the same group so the swatch row reads as one choice,
                      and shows a ring when the current ink is not a preset. */}
                  <input
                    type="color" aria-label="Custom pen colour" title={'Custom colour — ' + s.penInk}
                    value={s.penInk}
                    onChange={e => set({ penInk: e.target.value })}
                    style={{ width:'22px', height:'22px', borderRadius:'7px', padding:0, cursor:'pointer',
                      background:'transparent', appearance:'none', WebkitAppearance:'none',
                      border:'2px solid ' + (INK_COLORS.indexOf(s.penInk) < 0 ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-bg-surface))'),
                      boxShadow:'0 0 0 1px ' + BORDER_STRONG }}
                  />
                </div>
                <label style={lbl}>Stroke width — {s.penWidth}pt
                  <input
                    type="range" min={MIN_PEN_WIDTH} max={MAX_PEN_WIDTH} step={0.5} value={s.penWidth}
                    onChange={e => set({ penWidth: parseFloat(e.target.value) })}
                    style={{ width:'100%' }}
                  />
                </label>
                <button type="button" onClick={togglePen} style={ghostBtn}><Icon name="pencil" size={13} />Put the pen down</button>
              </div>
            ) : null}
          </div>

          <div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px' }}>
              <div style={railHead}>Pages</div>
              <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))' }}>{pages.length} in this PDF</span>
            </div>
            {/* Adding pages is `POST /api/documents/{id}/pages`: a blank sheet,
                or a file whose pages are converted and spliced in. */}
            <div style={{ marginTop:'8px' }}>
              <button type="button" onClick={() => setAddOpen(o => !o)} disabled={!hasFile || pageBusy}
                aria-expanded={addOpen} aria-controls="sf-add-page"
                style={Object.assign({}, ghostBtn, { width:'100%', justifyContent:'center' },
                  !hasFile || pageBusy ? { opacity:.55, cursor:'not-allowed' } : null)}>
                <Icon name="plus" size={13} />Add page
              </button>
              {addOpen ? (
                <div id="sf-add-page" style={{ marginTop:'8px', display:'flex', flexDirection:'column', gap:'8px',
                  border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'10px', padding:'10px', background:'hsl(var(--color-bg-surface))' }}>
                  <label style={lbl}>Position
                    <select value={addAfter} onChange={e => setAddAfter(parseInt(e.target.value, 10))} style={inputStyle}>
                      <option value={0}>At the end</option>
                      {pages.map(n => <option key={n} value={n}>After page {n}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => { void addPages({ blankCount: 1 }); }} disabled={pageBusy}
                    style={Object.assign({}, ghostBtn, { justifyContent:'center' }, pageBusy ? { opacity:.55, cursor:'progress' } : null)}>
                    <Icon name="file" size={13} />Blank page
                  </button>
                  <label style={lbl}>Image fit
                    <select value={addFit} onChange={e => setAddFit(e.target.value as ImageFit)} style={inputStyle}>
                      <option value="fit">Fit inside the page</option>
                      <option value="fill">Fill the page (crops)</option>
                      <option value="actual">Keep the image&rsquo;s own size</option>
                      <option value="custom">Choose the area&hellip;</option>
                    </select>
                  </label>
                  <button type="button" onClick={() => addFileRef.current?.click()} disabled={pageBusy}
                    style={Object.assign({}, ghostBtn, { justifyContent:'center' }, pageBusy ? { opacity:.55, cursor:'progress' } : null)}>
                    <Icon name="upload" size={13} />{pageBusy ? 'Adding…' : 'Upload file or image…'}
                  </button>
                  <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))' }}>
                    PDFs, images and documents such as .docx are converted to pages.
                    An image is laid on a page the size of the one it joins.
                  </span>
                  <input ref={addFileRef} type="file" accept={UPLOAD_ACCEPT}
                    onChange={e => { onAddFile(e.target.files?.[0]); e.target.value = ''; }}
                    aria-label="Choose a file to add as pages"
                    style={{ position:'absolute', width:1, height:1, padding:0, margin:-1, overflow:'hidden', clip:'rect(0 0 0 0)', border:0 }} />
                </div>
              ) : null}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginTop:'9px' }}>
              {thumbs.map(p => (
                <div key={p.key} style={p.style} draggable={p.draggable}
                  onDragStart={p.onDragStart} onDragOver={p.onDragOver} onDrop={p.onDrop} onDragEnd={p.onDragEnd}>
                  {p.dropAbove ? <span aria-hidden="true" style={Object.assign({ top:'-2px' }, p.dropLine)}></span> : null}
                  {p.dropBelowLast ? <span aria-hidden="true" style={Object.assign({ bottom:'-2px' }, p.dropLine)}></span> : null}
                  {p.draggable ? (
                    <span aria-hidden="true" title="Drag to reposition"
                      style={{ color:BORDER_STRONG, fontSize:'.6875rem', cursor:'grab', flex:'0 0 auto' }}>⠿</span>
                  ) : null}
                  <button type="button" onClick={p.onClick} aria-label={'Go to page ' + p.n}
                    style={{ display:'flex', alignItems:'center', gap:'10px', flex:1, minWidth:0, background:'transparent',
                      border:'none', padding:0, cursor:'pointer', textAlign:'left' }}>
                    <span style={p.sheet}>
                      <span style={p.line1}></span><span style={p.line2}></span><span style={p.line3}></span>
                    </span>
                    <span style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                      <span style={{ fontSize:'.75rem', fontWeight:600 }}>Page {p.n}</span>
                      <span style={p.badge}>{p.badgeLabel}</span>
                    </span>
                  </button>
                  <span style={{ display:'flex', flexDirection:'column', gap:'2px', marginLeft:'auto' }}>
                    <button type="button" onClick={p.onUp} disabled={!p.canUp} style={p.pageBtn(p.canUp)}
                      title={'Move page ' + p.n + ' up'} aria-label={'Move page ' + p.n + ' up'}><Icon name="caretUp" size={11} /></button>
                    <button type="button" onClick={p.onDown} disabled={!p.canDown} style={p.pageBtn(p.canDown)}
                      title={'Move page ' + p.n + ' down'} aria-label={'Move page ' + p.n + ' down'}><Icon name="caretDown" size={11} /></button>
                  </span>
                  <button type="button" onClick={p.onRemove} disabled={!p.canRemove} style={p.removeBtn(p.canRemove)}
                    title={'Delete page ' + p.n} aria-label={'Delete page ' + p.n}><Icon name="trash" size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </ResizableRail>

        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', background:'hsl(var(--color-bg-muted))' }}>
          <div data-sf-scroll="1" style={{ height:'46px', flex:'0 0 46px', borderBottom:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))', display:'flex', alignItems:'center', gap:'8px', padding:'0 14px', overflowX:'auto', overflowY:'hidden', scrollbarWidth:'thin' }}>
            <button type="button" aria-label="Undo" title="Undo" onClick={undo} disabled={!canUndo} style={Object.assign({}, iconBtn, canUndo ? null : { opacity: .45, cursor: 'not-allowed' })}><Icon name="undo" size={14} /></button>
            <button type="button" aria-label="Redo" title="Redo" onClick={redo} disabled={!canRedo} style={Object.assign({}, iconBtn, canRedo ? null : { opacity: .45, cursor: 'not-allowed' })}><Icon name="redo" size={14} /></button>
            <span style={{ flex:'0 0 auto', width:'1px', height:'20px', background:'hsl(var(--color-border-subtle))' }}></span>
            <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', gap:'2px', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'9px', padding:'2px' }}>
              <button type="button" aria-label="Zoom out" title="Zoom out" onClick={zoomOut} style={iconBtn}><Icon name="minus" size={13} /></button>
              <span style={{ minWidth:'52px', textAlign:'center', fontSize:'.75rem', fontFamily:'var(--font-sans)', color:'hsl(var(--color-fg-subtle))' }}>{zoomLabel}</span>
              <button type="button" aria-label="Zoom in" title="Zoom in" onClick={zoomIn} style={iconBtn}><Icon name="plus" size={13} /></button>
            </div>
            <button type="button" onClick={fitWidth} title="Fit width" aria-label="Fit width" style={toolBtn}><Icon name="fitWidth" size={14} /></button>
            <button type="button" onClick={fitPage} title="Fit page" aria-label="Fit page" style={toolBtn}><Icon name="fit" size={14} /></button>
            <span style={{ flex:'0 0 auto', width:'1px', height:'20px', background:'hsl(var(--color-border-subtle))' }}></span>
            <button type="button" onClick={toggleGrid} title="Snap grid" aria-label="Snap grid" aria-pressed={s.grid} style={gridBtnStyle}><Icon name="grid" size={14} /></button>
            <span style={{ flex:'0 0 auto', width:'1px', height:'20px', background:'hsl(var(--color-border-subtle))' }}></span>
            <div style={{ flex:'0 0 auto', display:'flex', alignItems:'center', gap:'6px' }}>
              <button type="button" onClick={I.alignLeft} title="Align left" aria-label="Align left" style={alignStyle}><Icon name="alignLeft" size={14} /></button>
              <button type="button" onClick={I.alignCenterX} title="Center" aria-label="Center" style={alignStyle}><Icon name="alignCenter" size={14} /></button>
              <button type="button" onClick={I.distribute} title="Distribute" aria-label="Distribute" style={alignStyle}><Icon name="distribute" size={14} /></button>
              <button type="button" onClick={I.duplicateSel} title="Duplicate" aria-label="Duplicate" style={alignStyle}><Icon name="duplicate" size={14} /></button>
              <button type="button" onClick={I.copyToAllPages} title="Copy to every page" aria-label="Copy to every page"
                disabled={pages.length < 2} style={Object.assign({}, alignStyle, pages.length < 2 ? { opacity:.45, cursor:'not-allowed' } : null)}><Icon name="duplicateAll" size={14} /></button>
              <button type="button" onClick={I.deleteSel} title="Delete" aria-label="Delete" style={dangerStyle}><Icon name="trash" size={14} /></button>
            </div>
            <button type="button" onClick={openPreview} title="Open preview" aria-label="Open preview" style={toolBtn}><Icon name="preview" size={14} /></button>
            <span style={{ flex:'0 0 auto', marginLeft:'auto', paddingLeft:'8px', fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>{selLabel}</span>
          </div>

          <div ref={attachViewport} onScroll={onCanvasScroll} data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', overscrollBehavior:'contain', padding:'26px', display:'flex', flexDirection:'column', alignItems:'center' }}>
            {pdfUrl ? (
              <LazyPdfPages
                fileUrl={pdfUrl}
                pages={pages}
                scale={z}
                onGeometry={onGeometry}
                pageBoxProps={(g) => ({
                  ref: I.registerSheet(g.page),
                  onPointerDown: I.onSheetDown,
                  style: s.penMode ? { cursor:'crosshair' } : undefined,
                })}
                renderOverlay={(g) => (
                  <>
                    <div style={gridOverlay}></div>

                    {/* Behind the buttons: which dots answer the same question. */}
                    {radioGroupBoxes(g.page).map(box => (
                      /* Decorative: every button already announces its group and
                         its position in it, so the outline is not read out again. */
                      <div key={box.key} aria-hidden="true" data-radio-group={box.key} style={box.box}>
                        <span style={box.labelStyle}>{box.label}</span>
                      </div>
                    ))}

                    {fieldsForPage(g.page).map(f => (
                      <div key={f.id} role="button" tabIndex={0} aria-label={f.aria} onPointerDown={f.onDown} onKeyDown={f.onKey} style={f.box}>
                        {!f.isAnn ? <span style={f.badge}>{f.badgeText}</span> : null}
                        {f.ink ? (
                          <svg viewBox={f.viewBox} width="100%" height="100%" aria-hidden="true"
                            style={{ position:'absolute', inset:0, pointerEvents:'none', overflow:'visible' }}>
                            {f.strokePaths.map((d, i) => (
                              <path key={i} d={d} fill="none" stroke={f.ink!.color} strokeWidth={f.inkWidth}
                                strokeLinecap="round" strokeLinejoin="round" />
                            ))}
                          </svg>
                        ) : null}
                        {f.tbox ? (
                          f.tboxText
                            ? <span style={f.textStyle!}>{f.tboxText}</span>
                            : <span style={f.emptyTextStyle}>Empty text box — type its text in the inspector</span>
                        ) : null}
                        {f.isCheck ? (
                          <span style={f.previewWrap}><span style={f.checkGlyph}><Icon name="checkbox" size={14} /></span></span>
                        ) : null}
                        {f.radio ? (
                          <span style={f.radioRing} aria-hidden="true">
                            <span style={f.radioCircle}>{f.radioOn ? <span style={f.radioFill}></span> : null}</span>
                          </span>
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
                              <span style={f.selectRow}><span>{f.selectText}</span><Icon name="caretDown" size={11} /></span>
                            ) : (
                              <span style={f.warnStyle}>No choices yet — add them in the inspector</span>
                            )}
                          </span>
                        ) : null}
                        {!f.isCheck && !f.isRadio && !f.radio && !f.isSelect && !f.isAnn ? (
                          <span style={f.inner}>{f.label}</span>
                        ) : null}
                        {f.selected ? (
                          <span onPointerDown={f.onResize} style={f.handle}></span>
                        ) : null}
                      </div>
                    ))}

                    {/* The selected field's inline toolbar — reassign, edit,
                        duplicate, delete, right where the field is. */}
                    {fieldToolbar && fieldToolbar.page === g.page ? (
                      <div style={fieldToolbar.wrap} onPointerDown={stopDown}
                        role="toolbar" aria-label={fieldToolbar.typeLabel + ' field'}>
                        <span onPointerDown={fieldToolbar.onGrip} style={fieldToolbar.gripStyle}
                          aria-hidden="true" title="Drag to move"><Icon name="move" size={12} /></span>
                        {!fieldToolbar.isAnn ? (
                          <>
                            <span style={fieldToolbar.dotStyle} aria-hidden="true"></span>
                            <select value={fieldToolbar.to} onChange={fieldToolbar.onReassign}
                              aria-label="Assigned recipient" title="Assigned recipient" style={fieldToolbar.selectStyle}>
                              {recipientOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                          </>
                        ) : (
                          <span style={fieldToolbar.annNoteStyle}>{fieldToolbar.typeLabel}</span>
                        )}
                        <span style={fieldToolbar.dividerStyle}></span>
                        <button type="button" onClick={fieldToolbar.onEdit} title="Edit field"
                          aria-label="Edit field" style={toolbarBtn}><Icon name="pencil" size={12} /></button>
                        <button type="button" onClick={fieldToolbar.onDuplicate} title="Duplicate field"
                          aria-label="Duplicate field" style={toolbarBtn}><Icon name="duplicate" size={12} /></button>
                        {fieldToolbar.canCopyAll ? (
                          <button type="button" onClick={fieldToolbar.onCopyAll} title="Copy to every page"
                            aria-label="Copy to every page" style={toolbarBtn}><Icon name="duplicateAll" size={12} /></button>
                        ) : null}
                        <button type="button" onClick={fieldToolbar.onDelete} title="Delete field"
                          aria-label="Delete field" style={toolbarDanger}><Icon name="trash" size={12} /></button>
                      </div>
                    ) : null}

                    {/* The gesture in flight, drawn straight onto the page in
                        page-point space so what the sender sees under the
                        cursor is exactly what gets stored. */}
                    {s.penStroke && s.penStroke.page === g.page ? (
                      <svg aria-hidden="true" width="100%" height="100%"
                        style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
                        <path
                          d={s.penStroke.points.map((pt, i) => (i ? 'L' : 'M') + (pt[0] * z).toFixed(2) + ' ' + (pt[1] * z).toFixed(2)).join('')}
                          fill="none" stroke={s.penInk} strokeWidth={Math.max(0.5, s.penWidth * z)}
                          strokeLinecap="round" strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                    {s.marquee && g.page === s.page ? <div style={marqueeStyle}></div> : null}
                    {g.page === s.page ? guides.map(line => <div key={line.key} style={line.style}></div>) : null}
                  </>
                )}
              />
            ) : (
              <div role="status" style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'14px', padding:'22px 20px', maxWidth:'420px',
                fontSize:'.78125rem', color:'hsl(var(--color-fg-subtle))', lineHeight:1.6, display:'flex', flexDirection:'column', alignItems:'flex-start', gap:'12px' }}>
                <span>Upload a file to this envelope before placing fields — the page you place them on has to be the document itself.</span>
                <UploadDocument documentId={documentId} label="Upload a file" />
              </div>
            )}
          </div>
        </div>

        <ResizableRail side="right" storageKey="sf.builder.rail.right" label="Inspector" defaultWidth={360} min={280} max={560}>
          {one ? (
            <div style={{ padding:'14px', display:'flex', flexDirection:'column', gap:'16px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <span style={inspIcon}>{meta(one.type).svg ? <Icon name={meta(one.type).svg!} size={13} /> : meta(one.type).icon}</span>
                <div style={{ display:'flex', flexDirection:'column', lineHeight:1.25 }}>
                  <span style={{ fontSize:'.84375rem', fontWeight:600 }}>
                    {oneRadio ? oneRadio.groupLabel : meta(one.type).label}
                  </span>
                  <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>
                    {oneRadio
                      ? oneRadio.choice + ' · button ' + (radioChoices.indexOf(oneRadio.choice) + 1)
                        + ' of ' + radioChoices.length + ' · page ' + one.page
                      : one.id + ' · page ' + one.page}
                  </span>
                </div>
              </div>

              {/* A field type the product does not fully implement says so here
                  rather than letting the sender assume it works. */}
              {meta(one.type).note ? (
                <div role="note" style={{ fontSize:'.71875rem', lineHeight:1.55, color:'hsl(var(--color-fg-warning))', background:'hsl(var(--color-bg-warning-subtle))',
                  border:'1px solid hsl(var(--color-border-warning))', borderRadius:'10px', padding:'9px 10px' }}>
                  <strong>Not implemented.</strong> {meta(one.type).note}
                </div>
              ) : null}

              <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                <label style={lbl}>Label
                  <input ref={inspectorFocusRef} type="text" value={one.label} onChange={e => editOne({ label: e.target.value })} style={input} />
                </label>
                {!oneIsAnn && !oneRadio && !onePayment ? (
                  <label style={lbl}>Placeholder
                    <input type="text" value={one.placeholder} onChange={e => setField(one.id, { placeholder: e.target.value })} style={input} />
                  </label>
                ) : null}
                {!oneIsAnn ? (
                  <label style={lbl}>Assigned recipient
                    <select value={one.to} onChange={e => editOne({ to: e.target.value })} style={input}>
                      {recipientOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </label>
                ) : null}
                {oneIsAnn ? (
                  <div role="note" style={{ fontSize:'.71875rem', lineHeight:1.55, color:'hsl(var(--color-accent-fg))', background:'hsl(var(--color-accent-subtle))',
                    border:'1px solid hsl(var(--color-accent-border))', borderRadius:'10px', padding:'9px 10px' }}>
                    Your own mark on the page. Nobody is asked to fill it in — it is drawn for every recipient and burned into the completed PDF.
                  </div>
                ) : null}
                {oneRadio ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:'8px', border:'1px solid hsl(var(--color-border-hairline))',
                    borderRadius:'11px', padding:'10px', background:'hsl(var(--color-bg-subtle))' }}>
                    <div style={railHead}>Radio buttons</div>
                    <div style={{ fontSize:'.71875rem', lineHeight:1.5, color:TEXT_MUTED }}>
                      Each button sits where you drag it on the page. The recipient picks one of them.
                    </div>
                    <div role="group" aria-label="Radio buttons in this group" style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                      {radioButtons.map((m, i) => {
                        const current = m.field.id === one.id;
                        return (
                          <div key={m.field.id} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                            <input
                              type="text"
                              aria-label={'Radio button ' + (i + 1) + ' label'}
                              value={radioDraft && radioDraft.id === m.field.id ? radioDraft.text : m.options.choice}
                              onChange={e => renameRadio(m, e.target.value)}
                              onFocus={() => set({ selected: [m.field.id], page: m.field.page })}
                              onBlur={() => setRadioDraft(null)}
                              style={Object.assign({}, input, current
                                ? { borderColor: A, boxShadow: '0 0 0 3px ' + A + '22' }
                                : {}) as CSSProperties}
                            />
                            <button
                              type="button"
                              onClick={() => removeRadioOption(m)}
                              aria-label={'Remove ' + m.options.choice}
                              title={radioButtons.length > 1 ? 'Remove this button' : 'Remove the group'}
                              style={{ width:'30px', height:'30px', flex:'0 0 30px', borderRadius:'8px', cursor:'pointer',
                                border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))', color:'hsl(var(--color-fg-danger))', fontSize:'.8125rem',
                                display:'grid', placeItems:'center' }}
                            ><Icon name="trash" size={12} /></button>
                          </div>
                        );
                      })}
                    </div>
                    <button type="button" onClick={addRadioOption} style={Object.assign({}, btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))'),
                      { width:'100%', justifyContent:'center' } as CSSProperties)}><Icon name="plus" size={13} />Add option</button>
                    <label style={lbl}>Pre-selected option
                      <select value={radioPreselected} onChange={e => setRadioPreselected(e.target.value)} style={input}>
                        <option value="">Nothing selected</option>
                        {radioChoices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                      </select>
                    </label>
                  </div>
                ) : null}
                {oneTextbox ? (
                  <>
                    <label style={lbl}>Text
                      <textarea
                        value={annText}
                        onChange={e => editDefault(e.target.value)}
                        rows={3}
                        placeholder="Type the text to print on the page"
                        style={Object.assign({}, input, { height:'auto', padding:'8px 11px', lineHeight:1.5, resize:'vertical',
                          fontFamily: textboxFontStack(oneTextbox.font) } as CSSProperties)}
                      />
                    </label>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 90px', gap:'8px' }}>
                      <label style={lbl}>Font
                        <select value={oneTextbox.font} onChange={e => editTextbox({ font: e.target.value })} style={input}>
                          {TEXTBOX_FONTS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                      </label>
                      <label style={lbl}>Size
                        <select value={String(oneTextbox.size)} onChange={e => editTextbox({ size: parseFloat(e.target.value) })} style={input}>
                          {(TEXTBOX_SIZES.indexOf(oneTextbox.size) > -1 ? TEXTBOX_SIZES : TEXTBOX_SIZES.concat([oneTextbox.size]).sort((a, b) => a - b))
                            .map(size => <option key={size} value={size}>{size} pt</option>)}
                        </select>
                      </label>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                      <button type="button" aria-pressed={oneTextbox.bold} onClick={() => editTextbox({ bold: !oneTextbox.bold })}
                        style={Object.assign({}, btn(oneTextbox.bold ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', oneTextbox.bold ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))'), { fontWeight:700 })}>B</button>
                      <button type="button" aria-pressed={oneTextbox.italic} onClick={() => editTextbox({ italic: !oneTextbox.italic })}
                        style={Object.assign({}, btn(oneTextbox.italic ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', oneTextbox.italic ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))'), { fontStyle:'italic' })}>I</button>
                      <div role="group" aria-label="Text colour" style={{ display:'flex', gap:'5px', marginLeft:'auto' }}>
                        {INK_COLORS.map(c => (
                          <button key={c} type="button" onClick={() => editTextbox({ color: c })}
                            aria-label={'Text colour ' + c} aria-pressed={oneTextbox.color === c} title={c}
                            style={{ width:'20px', height:'20px', borderRadius:'6px', background:c, cursor:'pointer',
                              border:'2px solid ' + (oneTextbox.color === c ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-bg-surface))'), boxShadow:'0 0 0 1px ' + BORDER_STRONG }} />
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
                {oneDrawing ? (
                  <>
                    <div style={{ fontSize:'.71875rem', color:TEXT_MUTED }}>
                      {oneDrawing.strokes.length === 1 ? '1 stroke' : oneDrawing.strokes.length + ' strokes'} — resize the box to scale the drawing.
                    </div>
                    <div role="group" aria-label="Ink colour" style={{ display:'flex', gap:'6px' }}>
                      {INK_COLORS.map(c => (
                        <button key={c} type="button" onClick={() => editDrawing({ color: c })}
                          aria-label={'Ink colour ' + c} aria-pressed={oneDrawing.color === c} title={c}
                          style={{ width:'22px', height:'22px', borderRadius:'7px', background:c, cursor:'pointer',
                            border:'2px solid ' + (oneDrawing.color === c ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-bg-surface))'), boxShadow:'0 0 0 1px ' + BORDER_STRONG }} />
                      ))}
                    </div>
                    <label style={lbl}>Stroke width — {oneDrawing.stroke}pt
                      <input type="range" min={MIN_PEN_WIDTH} max={MAX_PEN_WIDTH} step={0.5} value={oneDrawing.stroke}
                        onChange={e => editDrawing({ stroke: parseFloat(e.target.value) })} style={{ width:'100%' }} />
                    </label>
                  </>
                ) : null}
                {onePayment ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:'8px', border:'1px solid hsl(var(--color-border-hairline))',
                    borderRadius:'11px', padding:'10px', background:'hsl(var(--color-bg-subtle))' }}>
                    <div style={railHead}>Payment</div>
                    <label style={lbl}>Amount
                      <select value={onePayment.amount_mode}
                        onChange={e => editPayment({ amount_mode: e.target.value === 'signer_entered' ? 'signer_entered' : 'fixed' })}
                        style={input}>
                        <option value="fixed">Fixed amount</option>
                        <option value="signer_entered">Signer enters amount</option>
                      </select>
                    </label>
                    {onePayment.amount_mode === 'fixed' ? (
                      <label style={lbl}>Amount ({onePayment.currency})
                        <input type="text" inputMode="decimal" placeholder="0.00"
                          value={amountInputFromCents(onePayment.amount_cents)}
                          onChange={e => editPayment({ amount_cents: centsFromAmountInput(e.target.value) })}
                          style={input} />
                      </label>
                    ) : (
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                        <label style={lbl}>Minimum
                          <input type="text" inputMode="decimal" placeholder="0.50"
                            value={amountInputFromCents(onePayment.min_cents)}
                            onChange={e => editPayment({ min_cents: centsFromAmountInput(e.target.value) })}
                            style={input} />
                        </label>
                        <label style={lbl}>Maximum
                          <input type="text" inputMode="decimal" placeholder="no limit"
                            value={amountInputFromCents(onePayment.max_cents)}
                            onChange={e => editPayment({ max_cents: centsFromAmountInput(e.target.value) })}
                            style={input} />
                        </label>
                      </div>
                    )}
                    <label style={lbl}>Currency
                      <input type="text" value={onePayment.currency} maxLength={3}
                        onChange={e => editPayment({ currency: e.target.value.toUpperCase() })} style={input} />
                    </label>
                    <label style={lbl}>Memo
                      <input type="text" value={onePayment.memo ?? ''}
                        onChange={e => editPayment({ memo: e.target.value ? e.target.value : null })}
                        placeholder="e.g. Deposit for MSA-2291" style={input} />
                    </label>
                    <div style={{ fontSize:'.71875rem', lineHeight:1.5, color:TEXT_MUTED }}>
                      The memo appears on the signer’s card statement and in your Stripe dashboard for this charge.
                    </div>
                  </div>
                ) : null}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                  <label style={lbl}>X
                    <input type="number" value={one.x} onChange={e => setField(one.id, { x: parseInt(e.target.value || '0', 10) })} style={input} />
                  </label>
                  <label style={lbl}>Y
                    <input type="number" value={one.y} onChange={e => setField(one.id, { y: parseInt(e.target.value || '0', 10) })} style={input} />
                  </label>
                  <label style={lbl}>Width
                    <input type="number" value={one.w} onChange={e => setField(one.id, { w: Math.max(minSize.w, parseInt(e.target.value || String(minSize.w), 10)) })} style={input} />
                  </label>
                  <label style={lbl}>Height
                    <input type="number" value={one.h} onChange={e => setField(one.id, { h: Math.max(minSize.h, parseInt(e.target.value || String(minSize.h), 10)) })} style={input} />
                  </label>
                </div>
                {!oneIsAnn ? (
                <div style={{ display:'flex', flexDirection:'column', gap:'7px', border:'1px solid hsl(var(--color-border-hairline))', borderRadius:'11px', padding:'10px', background:'hsl(var(--color-bg-subtle))' }}>
                  <button type="button" role="switch" aria-checked={!!one.required} onClick={() => editOne({ required: !one.required })} style={rowBtn}>
                    <span style={{ fontSize:'.78125rem' }}>Required</span><span style={reqSwitch}><span style={reqKnob}></span></span>
                  </button>
                  <button type="button" role="switch" aria-checked={!!one.readOnly} onClick={() => editOne({ readOnly: !one.readOnly })} style={rowBtn}>
                    <span style={{ fontSize:'.78125rem' }}>Read-only</span><span style={roSwitch}><span style={roKnob}></span></span>
                  </button>
                </div>
                ) : null}
                {!oneIsAnn && !oneRadio && !onePayment ? (
                <label style={lbl}>Validation
                  <select value={one.validation} onChange={e => setField(one.id, { validation: e.target.value })} style={input}>
                    <option value="none">{impliedValidation ? 'Automatic (' + VALIDATION_LABEL[impliedValidation] + ')' : 'None'}</option>
                    <option value="email">Email</option>
                    <option value="date">Date (MM/DD/YYYY)</option>
                    <option value="numeric">Numeric</option>
                    <option value="custom">Custom regex</option>
                  </select>
                </label>
                ) : null}
                {!oneIsAnn && !oneRadio && !onePayment ? <div style={regexBox}>{REGEX_MAP[impliedValidation || one.validation]}</div> : null}

                {wantsChoices ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:'8px', border:'1px solid hsl(var(--color-border-hairline))',
                    borderRadius:'11px', padding:'10px', background:'hsl(var(--color-bg-subtle))' }}>
                    <div style={railHead}>Choices</div>
                    <div style={{ fontSize:'.71875rem', lineHeight:1.5, color:TEXT_MUTED }}>
                      One row per choice, in the order the recipient sees them. They pick one.
                    </div>
                    <div role="group" aria-label="Choices" style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                      {oneChoices.map((choice, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                          <input
                            type="text"
                            aria-label={'Choice ' + (i + 1)}
                            value={choice}
                            onChange={e => renameChoice(i, e.target.value)}
                            onBlur={settleChoices}
                            style={input}
                          />
                          <span style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'0 0 auto' }}>
                            <button type="button" onClick={() => moveChoice(i, -1)} disabled={i === 0}
                              aria-label={'Move ' + (choice || 'choice ' + (i + 1)) + ' up'}
                              style={choiceMoveBtn(i > 0)}><Icon name="caretUp" size={11} /></button>
                            <button type="button" onClick={() => moveChoice(i, 1)} disabled={i === oneChoices.length - 1}
                              aria-label={'Move ' + (choice || 'choice ' + (i + 1)) + ' down'}
                              style={choiceMoveBtn(i < oneChoices.length - 1)}><Icon name="caretDown" size={11} /></button>
                          </span>
                          <button
                            type="button"
                            onClick={() => removeChoice(i)}
                            aria-label={'Remove ' + (choice || 'choice ' + (i + 1))}
                            title="Remove this choice"
                            style={{ width:'30px', height:'30px', flex:'0 0 30px', borderRadius:'8px', cursor:'pointer',
                              border:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))', color:'hsl(var(--color-fg-danger))', fontSize:'.8125rem',
                              display:'grid', placeItems:'center' }}
                          ><Icon name="trash" size={12} /></button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={addChoice} style={Object.assign({}, btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))'),
                      { width:'100%', justifyContent:'center' } as CSSProperties)}><Icon name="plus" size={13} />Add option</button>
                    <div style={{ fontSize:'.71875rem', lineHeight:1.5, color: oneChoices.length ? 'hsl(var(--color-fg-success))' : 'hsl(var(--color-fg-warning))' }}>
                      {oneChoices.length
                        ? oneChoices.length + (oneChoices.length === 1 ? ' choice' : ' choices') + ' — the recipient picks one'
                        : 'No choices yet — the recipient is shown nothing to pick from until you add some.'}
                    </div>
                    <label style={lbl}>Pre-selected option
                      <select value={oneExtras?.defaultValue ?? ''} onChange={e => editDefault(e.target.value)} style={input}>
                        <option value="">Nothing selected</option>
                        {oneChoices.filter(choice => choice.trim().length > 0)
                          .map(choice => <option key={choice} value={choice}>{choice}</option>)}
                      </select>
                    </label>
                  </div>
                ) : null}

                {wantsDefault && !wantsChoices ? (
                  <label style={lbl}>Default value
                    <input
                      type="text"
                      value={oneExtras?.defaultValue ?? ''}
                      onChange={e => editDefault(e.target.value)}
                      placeholder="Pre-filled for the recipient"
                      style={input}
                    />
                  </label>
                ) : null}
              </div>

              {!oneIsAnn ? (
              <div style={{ borderTop:'1px solid hsl(var(--color-border-hairline))', paddingTop:'14px', display:'flex', flexDirection:'column', gap:'10px' }}>
                <div style={railHead}>Conditional logic</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'8px', border:'1px solid hsl(var(--color-border-hairline))', borderRadius:'11px', padding:'10px', background:'hsl(var(--color-bg-subtle))' }}>
                  <div style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))' }}>Show this field only if</div>
                  <select value={cond.field} onChange={e => editOne({ cond: e.target.value ? { field: e.target.value, op: cond.op, value: cond.value } : null })} style={input} aria-label="Trigger field">
                    <option value="">— always show —</option>
                    {condOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                    <select value={cond.op} onChange={e => { if (one.cond) editOne({ cond: Object.assign({}, one.cond, { op: e.target.value }) }); }} style={input} aria-label="Operator">
                      <option value="checked">is checked</option>
                      <option value="equals">equals</option>
                      <option value="notEmpty">is not empty</option>
                    </select>
                    <input type="text" value={cond.value} onChange={e => { if (one.cond) editOne({ cond: Object.assign({}, one.cond, { value: e.target.value }) }); }} placeholder="value" aria-label="Comparison value" style={input} />
                  </div>
                  <div style={condSummaryStyle}>{condSummary}</div>
                </div>
              </div>
              ) : null}

            </div>
          ) : null}
          {!one ? (
            <div style={{ padding:'30px 20px', display:'flex', flexDirection:'column', gap:'9px', textAlign:'center', color:TEXT_MUTED }}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, color:'hsl(var(--color-fg-subtle))' }}>No field selected</span>
              <span style={{ fontSize:'.75rem', lineHeight:1.5 }}>Select a field on the page — or lasso several — to configure labels, validation and conditional logic.</span>
            </div>
          ) : null}
        </ResizableRail>
      </div>

      {s.wizardStep === 2 ? (
        <div data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', padding:'22px', display:'grid', gridTemplateColumns:'minmax(0,1.5fr) minmax(0,1fr)', gap:'16px', alignItems:'start', background:'hsl(var(--color-bg-muted))' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
                <div style={railHead}>Recipients &amp; signing order</div>
                <div style={{ display:'flex', gap:'4px', background:'hsl(var(--color-bg-canvas))', padding:'4px', borderRadius:'10px' }}>
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
                      <span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>{r.email}</span>
                    </div>
                    <select value={r.role} onChange={r.onRole} aria-label="Role" style={r.selectStyle}>
                      <option value="sign">Needs to sign</option>
                      <option value="inperson">In-person signer</option>
                      <option value="copy">Receives a copy</option>
                      <option value="approve">Approver</option>
                    </select>
                    <div style={{ display:'flex', gap:'4px' }}>
                      <button type="button" aria-label="Move up" onClick={r.onUp} style={iconBtn}><Icon name="arrowUp" size={13} /></button>
                      <button type="button" aria-label="Move down" onClick={r.onDown} style={iconBtn}><Icon name="arrowDown" size={13} /></button>
                      <button type="button" aria-label={'Remove ' + r.name} title={'Remove ' + r.name} onClick={r.onRemove}
                        style={Object.assign({}, iconBtn, { color:'hsl(var(--color-fg-danger))' })}><Icon name="close" size={13} /></button>
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

            <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={railHead}>Invite email</div>
              <label style={lbl}>Subject
                <input type="text" value={subject} onChange={e => changeRouting({ subject: e.target.value })} placeholder={docTitle + ': signature request'} style={input} />
              </label>
              <label style={lbl}>Message
                <textarea rows={4} onChange={e => changeRouting({ message: e.target.value })} value={s.message} style={textareaStyle}></textarea>
              </label>
            </div>

            <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
              <div style={railHead}>Payment request</div>

              {paymentNoStripe ? (
                <div role="alert" style={{ fontSize:'.75rem', lineHeight:1.6, color:'hsl(var(--color-fg-warning))', background:'hsl(var(--color-bg-warning-subtle))',
                  border:'1px solid hsl(var(--color-border-warning))', borderRadius:'10px', padding:'9px 10px', display:'flex', flexDirection:'column', gap:'4px' }}>
                  <span><strong>This envelope cannot be sent for payment yet.</strong> Connect a Stripe account with charges enabled first.</span>
                  <Link href="/account/payments" style={{ color:'hsl(var(--color-fg-warning))', textDecoration:'underline', fontWeight:600 }}>Go to Payments</Link>
                </div>
              ) : null}

              <div style={{ display:'grid', gridTemplateColumns:'1fr 90px', gap:'8px' }}>
                <label style={lbl}>Total amount
                  <input type="text" inputMode="decimal" placeholder="0.00" value={paymentDraft.total}
                    onChange={e => setPaymentDraft(prev => Object.assign({}, prev, { total: e.target.value }))}
                    style={input} />
                </label>
                <label style={lbl}>Currency
                  <input type="text" maxLength={3} value={paymentDraft.currency}
                    onChange={e => setPaymentDraft(prev => Object.assign({}, prev, { currency: e.target.value.toUpperCase() }))}
                    style={input} />
                </label>
              </div>
              <label style={lbl}>Memo
                <input type="text" value={paymentDraft.memo}
                  onChange={e => setPaymentDraft(prev => Object.assign({}, prev, { memo: e.target.value }))}
                  placeholder="Shown on the signer’s card statement and your Stripe dashboard" style={input} />
              </label>

              <div role="group" aria-label="Split" style={{ display:'flex', gap:'4px', background:'hsl(var(--color-bg-canvas))', padding:'4px', borderRadius:'10px' }}>
                {(['single', 'equal', 'custom'] as PaymentSplitMode[]).map(mode => (
                  <button key={mode} type="button" onClick={() => setPaymentSplitMode(mode)}
                    aria-pressed={paymentDraft.splitMode === mode}
                    style={{ flex:1, height:'26px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem',
                      fontWeight: paymentDraft.splitMode === mode ? 600 : 500,
                      background: paymentDraft.splitMode === mode ? 'hsl(var(--color-bg-surface))' : 'transparent',
                      color: paymentDraft.splitMode === mode ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))',
                      boxShadow: paymentDraft.splitMode === mode ? '0 1px 2px rgba(15,23,42,.12)' : 'none' }}>
                    {mode === 'single' ? 'Single payer' : mode === 'equal' ? 'Split equally' : 'Custom split'}
                  </button>
                ))}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                {payableRecipients.map(r => {
                  const hasField = !!paymentFieldFor(r.id);
                  const checked = paymentDraft.payerIds.indexOf(r.id) > -1;
                  const idx = paymentDraft.payerIds.indexOf(r.id);
                  const equalAmount = idx > -1 ? paymentEqualAmounts[idx] : null;
                  return (
                    <div key={r.id} style={{ display:'flex', alignItems:'center', gap:'8px', opacity: hasField ? 1 : .55 }}>
                      <input
                        type={paymentDraft.splitMode === 'single' ? 'radio' : 'checkbox'}
                        name="payment-payer"
                        aria-label={'Charge ' + r.name}
                        checked={checked}
                        disabled={!hasField}
                        onChange={() => togglePaymentPayer(r.id)}
                      />
                      <span style={{ fontSize:'.78125rem', flex:1 }}>{r.name}</span>
                      {!hasField ? (
                        <button type="button" onClick={() => placePaymentField(r.id)}
                          style={{ fontSize:'.65625rem', color:'hsl(var(--color-fg-warning))', background:'none', border:'1px solid hsl(var(--color-border-warning))', borderRadius:'6px', padding:'3px 7px', cursor:'pointer' }}>
                          No payment field placed · place one
                        </button>
                      ) : null}
                      {paymentDraft.splitMode === 'equal' && checked ? (
                        <span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>
                          {paymentDraft.currency} {amountInputFromCents(equalAmount)}
                        </span>
                      ) : null}
                      {paymentDraft.splitMode === 'custom' && checked ? (
                        <input type="text" inputMode="decimal" placeholder="0.00" aria-label={r.name + '’s amount'}
                          value={paymentDraft.customAmounts[r.id] ?? ''}
                          onChange={e => setPaymentCustomAmount(r.id, e.target.value)}
                          style={Object.assign({}, input, { width:'80px' } as CSSProperties)} />
                      ) : null}
                    </div>
                  );
                })}
                {payableRecipients.length === 0 ? (
                  <span style={{ fontSize:'.75rem', color:TEXT_MUTED }}>No signing recipients to charge yet — a copy-only recipient can never be asked to pay.</span>
                ) : null}
              </div>

              {paymentDraft.splitMode === 'custom' ? (
                <div style={{ fontSize:'.71875rem', color: paymentAllocations().reduce((t, a) => t + a.amount_cents, 0) === paymentTotalCents ? 'hsl(var(--color-fg-success))' : 'hsl(var(--color-fg-warning))' }}>
                  {amountInputFromCents(paymentAllocations().reduce((t, a) => t + a.amount_cents, 0))} of {amountInputFromCents(paymentTotalCents)} allocated
                </div>
              ) : null}

              {paymentValidation.length ? (
                <ul style={{ margin:0, paddingLeft:'18px', display:'flex', flexDirection:'column', gap:'3px' }}>
                  {paymentValidation.map((msg, i) => (
                    <li key={i} style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-danger))' }}>{msg}</li>
                  ))}
                </ul>
              ) : null}

              <button type="button" onClick={savePaymentRequest} disabled={paymentSaving || paymentValidation.length > 0}
                style={Object.assign({}, btn(A, 'hsl(var(--color-fg-on-solid))', A), { justifyContent:'center',
                  opacity: paymentSaving || paymentValidation.length > 0 ? .6 : 1 } as CSSProperties)}>
                {paymentSaving ? 'Saving…' : 'Save payment request'}
              </button>
              {paymentRequest ? (
                <div style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))' }}>
                  {paymentRequest.paid_count} of {paymentRequest.allocation_count} paid so far —
                  {' '}{amountInputFromCents(paymentRequest.collected_cents)} {paymentRequest.currency} collected.
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
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
            <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
              <div style={railHead}>Before you send</div>
              {sendChecks.map(c => (
                <div key={c.label} style={{ display:'flex', alignItems:'flex-start', gap:'9px', padding:'7px 0', borderTop:'1px solid hsl(var(--color-border-faint))' }}>
                  <span style={c.dot}></span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{c.label}</span>
                    <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.5 }}>{c.meta}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {cropping ? (
        <ImageCropDialog file={cropping} pageAspect={addPageAspect} onDone={onCropped(cropping)} />
      ) : null}
    </section>
  );
}
