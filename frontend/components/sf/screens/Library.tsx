'use client';

/* SignerPro — DOCUMENT LIBRARY screen (isDash). Ported verbatim from the prototype.
 *
 * Data comes from `app/(app)/documents/page.tsx` (props); the filters, the
 * search box, the selection and the open row menu stay in `lib/sf/state.tsx`.
 * Every filter is mirrored into the URL so the server page refetches — the
 * markup below is untouched apart from an empty-state branch the prototype's
 * always-populated mock never needed. */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { documentPathFor, type ScreenKey } from '@/lib/sf/routes';
import { useMenuPlacement } from '@/lib/sf/menuPlacement';
import { btn, pill, linkBtn, BORDER_STRONG, TEXT_MUTED } from '@/lib/sf/ui';
import {
  QUICK_ACCESS, LIB_FOLDERS, LIB_FILTER_DEFS, LIB_SORT_OPTIONS, ROW_ACTIONS,
  STATUS,
} from '@/lib/sf/data';
import { DOCUMENT_FOLDERS, DOCUMENT_VIEWS, badge, folderHref } from '@/lib/sf/navigation';
import { apiCall, apiDownload, saveBlob } from '@/lib/api/browser';
import type { ApiResult } from '@/lib/api/result';
import type { DocumentCounts } from '@/lib/api/types';
import { audit as auditApi, documents as documentsApi, folders as foldersApi, templates as templatesApi } from '@/lib/api/resources';
import { useDialogs, type AskConfirmOptions } from '@/components/sf/DialogProvider';
import UploadDocument from '@/components/sf/UploadDocument';
import CatalogBrowser from '@/components/sf/CatalogBrowser';
import Icon, { markFor } from '@/components/sf/Icon';
import {
  docStatusDetail, libraryFiltersToQuery, libraryFolderLabel, signerProgressLabel,
  type FolderOption, type LibraryFilters, type LibraryRow, type TemplateRow,
} from '@/lib/sf/adapters';

export type LibraryProps = {
  /** One design page of documents for the active folder + filters. */
  rows: LibraryRow[];
  /** `DocumentLibraryPage.total` — every document the filters match. */
  total: number;
  /** Real templates, for the `templates` folder view. */
  templates: TemplateRow[];
  templateTotal: number;
  /** `GET /api/folders/tree`, flattened — the "Move to folder" targets, and
   *  the folder chips below the filters. */
  folderOptions: FolderOption[];
  /** `GET /api/documents/counts` — the figure beside each view and folder.
   *  Partial: a failed counts call leaves the chips unbadged rather than
   *  printing a fabricated zero. */
  counts?: Partial<DocumentCounts>;
  /** The filters the URL asked for, so a shared link seeds the selects. */
  initialFilters: LibraryFilters;
};

/**
 * Row actions the design lists that no endpoint backs. They are not rendered at
 * all — the prototype made them toast-only, which told the user their document
 * had been emailed, shared or exported when nothing had happened.
 *
 * `Download`, `Download with certificate` and `Print` are *not* in this set:
 * `GET /api/documents/{id}/final-pdf` serves the executed PDF and is wired below.
 */
const REMOVED_ACTIONS = new Set([
  'Email a copy', 'Create invite link', 'Freeform invite', 'Notarize', 'Quick preview',
  'Share', 'Export to cloud', 'Merge document with…',
]);

export default function Library(props: LibraryProps) {
  const { rows, total, templates, templateTotal, folderOptions, counts = {}, initialFilters } = props;
  const { s, set, flash, accent } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();
  const { askText, askChoice, askConfirm } = useDialogs();
  /* The row menu opens upwards when the row it belongs to is near the bottom of
     the window — the last rows of a long list had theirs cut off by the edge. */
  const { anchorRef: menuAnchor, menuStyle } = useMenuPlacement(s.menuDoc, {
    onDismiss: () => set({ menuDoc: null }),
  });

  const primaryBtn = btn(A, 'hsl(var(--color-fg-on-solid))', A);
  const ghostBtn = btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))');

  /* ── filters live in the URL ────────────────────────────────────────────
     The URL is the only copy. The selects used to write to the store and an
     effect mirrored the store back into the query string, seeded once on
     mount — so a link that set `?folder=inbox` (which is what every sidebar
     view row is now) changed the address bar and was immediately overwritten
     by the stale store value. Reading straight off the server-resolved
     filters removes the second copy and the race with it. */
  const filters = initialFilters;

  const pushFilters = useCallback((patch: Partial<LibraryFilters>) => {
    const next = libraryFiltersToQuery({ ...filters, ...patch });
    router.replace('/documents' + next, { scroll: false });
  }, [filters, router]);

  /* Typing is the one thing that cannot go straight to the URL — that would be
     one navigation per keystroke — so the box is local and debounced into it. */
  const [queryDraft, setQueryDraft] = useState(initialFilters.q);
  /* Open the drawer when a shared link arrives with filters already set —
     otherwise the list looks short for no visible reason. */
  const activeFilterCount = (['status', 'type', 'time', 'owner'] as const)
    .filter(k => initialFilters[k] !== 'all').length;
  const [showFilters, setShowFilters] = useState(activeFilterCount > 0);
  useEffect(() => { setQueryDraft(initialFilters.q); }, [initialFilters.q]);
  useEffect(() => {
    if (queryDraft === filters.q) return;
    const timer = setTimeout(() => pushFilters({ q: queryDraft }), 300);
    return () => clearTimeout(timer);
  }, [queryDraft, filters.q, pushFilters]);

  /* ── mutations ─────────────────────────────────────────────────────────
     Optimistic toast first (the prototype's behaviour), then the call, then a
     refresh so the server page re-renders the row. */
  const run = useCallback((optimistic: string, call: () => Promise<ApiResult<unknown>>) => {
    flash(optimistic);
    void call().then(res => {
      if (!res.ok) { flash('Could not complete · ' + res.error.message); return; }
      router.refresh();
    });
  }, [flash, router]);

  /* Archiving, trashing and purging all take a document out of the list the
     user is looking at, and a purge cannot be undone at all — each asks first.
     Restoring and unarchiving put a document back, so they stay one click. */
  const confirmRun = useCallback((
    opts: AskConfirmOptions,
    optimistic: string,
    call: () => Promise<ApiResult<unknown>>,
  ) => {
    void askConfirm(opts).then(ok => { if (ok) run(optimistic, call); });
  }, [askConfirm, run]);

  const libFolderLabel = libraryFolderLabel(
    filters.folder,
    (QUICK_ACCESS as [string, string, number, string][])
      .map(f => [f[0], f[1]] as [string, string])
      .concat(LIB_FOLDERS.map(f => [f[0], f[1]] as [string, string])),
    folderOptions,
  );

  const isTemplateFolder = filters.folder === 'templates';
  /* The platform's ready-made forms. Opened from the templates view only:
     the catalog produces templates, so it belongs where templates live. */
  const [showCatalog, setShowCatalog] = useState(false);
  const isArchiveFolder = filters.folder === 'archive';
  const isTrashFolder = filters.folder === 'trash';
  const libDocs = rows;

  const libCountLabel =
    (isTemplateFolder ? templateTotal : total) +
    (isTemplateFolder ? ' templates' : ' documents');

  const dateFieldLabel: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)',
  };

  const filterSelectStyle: CSSProperties = {
    height: '30px', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '9px', padding: '0 9px',
    fontSize: '.75rem', background: 'hsl(var(--color-bg-surface))', color: 'hsl(var(--color-fg-subtle))', outline: 'none',
  };

  /** `libStatus` → `status`: the store keys the design used, mapped onto the
   *  query keys the URL and the server page speak. */
  const FILTER_KEY: Record<string, keyof LibraryFilters> = {
    libStatus: 'status', libType: 'type', libTime: 'time', libOwner: 'owner',
  };
  const libFilters = LIB_FILTER_DEFS.map(([key, opts]) => ({
    key,
    value: filters[FILTER_KEY[key]],
    options: opts.map(([id, label]) => ({ id, label })),
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
      pushFilters({ [FILTER_KEY[key]]: e.target.value } as Partial<LibraryFilters>),
    style: filterSelectStyle,
  }));

  const libSortOptions = LIB_SORT_OPTIONS.map(([id, label]) => ({ id, label }));

  /* Which folder to move into is a question for the user. It used to resolve
     to `folderOptions[0]` — every "Move to folder" silently filed the document
     in whichever folder happened to sort first. */
  const NO_FOLDER = '__unfiled__';
  const moveChoices = [{ id: NO_FOLDER, label: 'Unfiled (no folder)' }]
    .concat(folderOptions.map(f => ({ id: f.id, label: f.name })));
  const askFolder = async (message: string): Promise<{ id: string | null; name: string } | null> => {
    if (!folderOptions.length) { flash('No folders yet — create one first'); return null; }
    const picked = await askChoice({
      title: 'Move to folder', message, label: 'Folder', options: moveChoices, cta: 'Move',
    });
    if (!picked) return null;
    if (picked === NO_FOLDER) return { id: null, name: 'Unfiled' };
    const folder = folderOptions.find(f => f.id === picked);
    return folder ? { id: folder.id, name: folder.name } : null;
  };

  const libRows = (isTemplateFolder ? templates : libDocs).map((d: any, i: number) => {
    const isTpl = isTemplateFolder;
    /** The real UUID — what the API takes. `d.id` stays the design's reference. */
    const uid: string = isTpl ? d.templateId : d.documentId;
    /* The pill says exactly where the envelope stands — Sent, Viewed, In
       progress, Signed — rather than the five-way bucket the filters use. */
    const st = isTpl ? STATUS.completed : docStatusDetail(d.rawStatus ?? d.status);
    const checked = s.libSelected.indexOf(uid) > -1;

    /* The printable PDF for a row. `final-pdf` only exists once signing has
       completed; before that the honest thing to hand over is the document as
       it stands — `GET /api/documents/{id}/pdf`, the uploaded original — rather
       than refusing outright. The caller is told which of the two it got so the
       toast does not call an unsigned copy "signed". */
    const fetchPrintable = async () => {
      const signed = await apiDownload(documentsApi.finalPdfPath(uid), { filename: d.title + '-signed.pdf' });
      if (signed.ok) return { res: signed, executed: true as const };
      if (signed.status !== 404) return { res: signed, executed: true as const };
      const original = await apiDownload(documentsApi.pdfPath(uid), { filename: d.title + '.pdf' });
      return { res: original, executed: false as const };
    };

    /** The executed PDF when there is one, the original otherwise. */
    const downloadPdf = () => {
      flash('Preparing ' + d.title + '…');
      void fetchPrintable().then(({ res, executed }) => {
        if (!res.ok) {
          flash(res.status === 404
            ? 'No PDF for ' + d.title + ' — nothing has been uploaded yet'
            : 'Could not download ' + d.title + ' · ' + res.error.message);
          return;
        }
        saveBlob(res.data);
        if (!executed) flash(d.title + ' is not signed yet — downloaded the document as it stands');
      });
    };

    /* The certificate of completion — the audit trail as a PDF. Built from the
       live chain, so it is there for an in-flight envelope too. */
    const downloadWithCertificate = () => {
      if (isTpl) { flash('A template has no certificate — only a sent envelope does'); return; }
      flash('Preparing the certificate for ' + d.title + '…');
      void apiDownload(auditApi.certificatePdfPath(uid), { filename: d.title + '-certificate.pdf' }).then(res => {
        if (!res.ok) { flash('Could not download the certificate · ' + res.error.message); return; }
        saveBlob(res.data);
      });
    };

    /** Print opens the same real PDF in a viewer; the browser prints from there. */
    const printPdf = () => {
      flash('Opening ' + d.title + ' to print…');
      void fetchPrintable().then(({ res, executed }) => {
        if (!res.ok) {
          flash(res.status === 404
            ? 'No PDF for ' + d.title + ' — nothing has been uploaded yet'
            : 'Could not open ' + d.title + ' · ' + res.error.message);
          return;
        }
        if (!executed) flash(d.title + ' is not signed yet — printing the document as it stands');
        const url = URL.createObjectURL(res.data.blob);
        const w = window.open(url, '_blank');
        if (!w) { flash('Allow pop-ups to print ' + d.title); URL.revokeObjectURL(url); return; }
        w.addEventListener('load', () => { w.print(); }, { once: true });
      });
    };

    /* A shareable link to the row itself — the document's own URL, absolute so
       it survives being pasted into an email or a chat. Recipients get their
       own tokenised signing links when the envelope is sent; this is the
       internal link a colleague with access can open. */
    const copyLink = () => {
      const path = documentPathFor('builder', uid);
      const url = (typeof window === 'undefined' ? '' : window.location.origin) + path;
      const copied = typeof navigator !== 'undefined' && navigator.clipboard
        ? navigator.clipboard.writeText(url)
        : null;
      if (!copied) { flash('Copy is unavailable in this browser · ' + url); return; }
      void copied.then(
        () => flash('Link to ' + d.title + ' copied'),
        () => flash('Could not copy the link · ' + url),
      );
    };

    /** Row action → endpoint. Anything without one is not offered at all. */
    const actionCall = (label: string): (() => void) | null => {
      if (label === 'Copy link') return copyLink;
      if (label === 'Download') return downloadPdf;
      if (label === 'Download with certificate') return downloadWithCertificate;
      if (label === 'Print') return printPdf;
      if (isTpl) {
        switch (label) {
          case 'Make template':
          case 'Duplicate':
            return () => run('Template duplicated', () => templatesApi.duplicate(apiCall, uid));
          case 'Rename': {
            return () => {
              void askText({ title: 'Rename template', label: 'Template name', defaultValue: d.title, cta: 'Rename', required: true }).then(title => {
                if (!title || title === d.title) return;
                run(title + ' renamed', () => templatesApi.update(apiCall, uid, { title }));
              });
            };
          }
          case 'Move to folder':
            return () => { void askFolder(d.title).then(target => {
              if (!target) return;
              run('Moved to ' + target.name, () => templatesApi.update(apiCall, uid, { folder_id: target.id }));
            }); };
          case 'Archive':
            return isArchiveFolder
              ? () => run(d.title + ' restored', () => templatesApi.restore(apiCall, uid))
              : () => confirmRun(
                {
                  title: 'Archive this template?',
                  message: d.title + ' moves to Archive. You can restore it from there.',
                  cta: 'Archive', danger: true,
                },
                d.title + ' archived', () => templatesApi.archive(apiCall, uid));
          default:
            return null;
        }
      }
      switch (label) {
        case 'Make template':
          return () => run(d.title + ' saved as a template', () => documentsApi.makeTemplate(apiCall, uid));
        case 'Duplicate':
          return () => run(d.title + ' duplicated', () => documentsApi.duplicate(apiCall, uid));
        case 'Rename':
          return () => {
            void askText({ title: 'Rename document', label: 'Document name', defaultValue: d.title, cta: 'Rename', required: true }).then(title => {
              if (!title || title === d.title) return;
              run(title + ' renamed', () => documentsApi.rename(apiCall, uid, title));
            });
          };
        case 'Move to folder':
          return () => { void askFolder(d.title).then(target => {
            if (!target) return;
            run('Moved to ' + target.name, () => documentsApi.move(apiCall, uid, target.id));
          }); };
        case 'Archive':
          if (isArchiveFolder) return () => run(d.title + ' unarchived', () => documentsApi.unarchive(apiCall, uid));
          if (isTrashFolder) return () => run(d.title + ' restored', () => documentsApi.restore(apiCall, uid));
          return () => confirmRun(
            {
              title: 'Archive this document?',
              message: d.title + ' moves to Archive. You can unarchive it from there.',
              cta: 'Archive', danger: true,
            },
            d.title + ' archived', () => documentsApi.archive(apiCall, uid));
        case 'Delete':
          if (isTrashFolder) {
            return () => confirmRun(
              {
                title: 'Delete this document permanently?',
                message: d.title + ' will be erased. This cannot be undone.',
                cta: 'Delete permanently', danger: true,
              },
              d.title + ' deleted permanently',
              () => documentsApi.bulk(apiCall, { document_ids: [uid], action: 'purge' }));
          }
          return () => confirmRun(
            {
              title: 'Move this document to Trash?',
              message: d.title + ' moves to Trash. You can restore it from there.',
              cta: 'Move to Trash', danger: true,
            },
            d.title + ' moved to Trash', () => documentsApi.trash(apiCall, uid));
        default:
          return null;
      }
    };

    const primaryLabel = isTpl ? 'Use template' : (d.status === 'draft' ? 'Prepare and send' : 'Invite to sign');

    /* The builder is a two-step wizard: 1 = Prepare (place the fields),
       2 = Set up and send (recipients, then the send modal). Menu entries that
       open the builder say which step they mean, so `Add fields` is not a
       third alias for `Open`. */
    const BUILDER_STEP: Record<string, number> = { 'Add fields': 1, 'Prepare and send': 2 };

    return {
      id: uid,
      title: d.title,
      checked: checked ? 'true' : 'false',
      meta: isTpl
        ? d.id + ' · ' + d.fields + ' fields · used ' + d.uses + '× · updated ' + d.updated
        : d.id + ' · ' + d.pages + ' pages · updated ' + d.updated,
      statusLabel: isTpl ? 'Template' : st.label,
      pillStyle: pill(isTpl ? { bg: 'hsl(var(--color-accent-subtle))', fg: 'hsl(var(--color-accent-fg))', bd: 'hsl(var(--color-accent-border))' } : st),
      signers: isTpl
        ? 'Owner ' + d.owner
        : signerProgressLabel(d.rawStatus ?? d.status, d.signed || 0, d.total || 0),
      rowStyle: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
        borderTop: i ? '1px solid hsl(var(--color-border-faint))' : 'none',
        background: checked ? 'hsl(var(--color-bg-subtle))' : 'transparent', flexWrap: 'wrap',
      } as CSSProperties,
      /* Same children, stacked: the tile is a column so the title and the
         action sit under the thumbnail rather than beside it. */
      cardStyle: {
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px',
        padding: '12px', border: '1px solid ' + (checked ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-hairline))'), borderRadius: '12px',
        background: checked ? 'hsl(var(--color-bg-subtle))' : 'hsl(var(--color-bg-surface))', minWidth: 0,
      } as CSSProperties,
      onCheck: () => set(st2 => ({
        libSelected: checked ? st2.libSelected.filter(x => x !== uid) : st2.libSelected.concat([uid]),
      })),
      thumb: {
        width: '40px', height: '50px', borderRadius: '5px', background: 'hsl(var(--color-bg-surface))',
        border: '1px solid hsl(var(--color-border-subtle))', flex: '0 0 40px', display: 'flex',
        flexDirection: 'column', gap: '3px', padding: '6px 5px', overflow: 'hidden',
      } as CSSProperties,
      line1: { height: '2px', background: BORDER_STRONG, borderRadius: '2px' } as CSSProperties,
      line2: { height: '2px', background: 'hsl(var(--color-border-subtle))', borderRadius: '2px', width: '82%' } as CSSProperties,
      line3: { height: '2px', background: 'hsl(var(--color-border-subtle))', borderRadius: '2px', width: '64%' } as CSSProperties,
      line4: { height: '2px', background: 'hsl(var(--color-border-subtle))', borderRadius: '2px', width: '74%' } as CSSProperties,
      onOpen: () => { set({ wizardStep: 1 }); go('builder', { documentId: uid }); },
      /* The design gives favourites no affordance of their own, so the row
         title carries the toggle on double-click until one is designed. */
      onFavorite: isTpl ? undefined : () => {
        if (d.isFavorite) run(d.title + ' removed from Favorites', () => documentsApi.unfavorite(apiCall, uid));
        else run(d.title + ' added to Favorites', () => documentsApi.favorite(apiCall, uid));
      },
      primaryLabel,
      onPrimary: isTpl
        ? () => {
          flash('Document created from ' + d.title);
          void templatesApi.use(apiCall, uid).then(res => {
            if (!res.ok) { flash('Could not complete · ' + res.error.message); return; }
            set({ wizardStep: 1 });
            // The template mints a *new* document; the builder opens that one.
            go('builder', { documentId: res.data.id });
          });
        }
        : () => { set({ wizardStep: 1 }); go('builder', { documentId: uid }); },
      onTemplate: isTpl
        ? () => run('Template duplicated', () => templatesApi.duplicate(apiCall, uid))
        : () => run(d.title + ' saved as a template', () => documentsApi.makeTemplate(apiCall, uid)),
      menuOpen: s.menuDoc === uid,
      onMenu: (e: React.MouseEvent) => {
        e.stopPropagation();
        set({ menuDoc: s.menuDoc === uid ? null : uid });
      },
      menuBtn: {
        width: '28px', height: '28px', borderRadius: '8px', border: '1px solid hsl(var(--color-border-subtle))',
        background: 'hsl(var(--color-bg-surface))', cursor: 'pointer', color: 'hsl(var(--color-fg-subtle))', fontSize: '.8125rem',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1, flex: '0 0 28px',
      } as CSSProperties,
      uid,
      actions: ROW_ACTIONS.filter(([label]) => !REMOVED_ACTIONS.has(label) && label !== primaryLabel).map(([label, target]) => {
        const wired = actionCall(label);
        return {
          label,
          onClick: () => {
            set({ menuDoc: null, wizardStep: BUILDER_STEP[label] ?? 1 });
            if (wired) { wired(); return; }
            if (target) go(target as ScreenKey, { documentId: uid });
            else flash(label + ' — ' + d.title);
          },
          style: {
            display: 'flex', alignItems: 'center', gap: '7px', width: '100%', textAlign: 'left', padding: '7px 10px',
            borderRadius: '7px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: '.78125rem',
            color: (label === 'Delete' || label === 'Archive') ? 'hsl(var(--color-fg-danger))' : 'hsl(var(--color-fg-subtle))',
          } as CSSProperties,
        };
      }),
    };
  });

  /* `POST /api/folders` — the prototype only flashed "Folder created in …". */
  const createFolder = async () => {
    const name = await askText({ title: 'New folder', label: 'Folder name', placeholder: 'e.g. Q3 contracts', cta: 'Create', required: true });
    if (!name) return;
    flash('Creating ' + name + '…');
    void foldersApi.create(apiCall, { name }).then(res => {
      if (!res.ok) { flash('Could not create the folder · ' + res.error.message); return; }
      flash(res.data.name + ' created');
      router.refresh();
    });
  };

  /* ── views and folders ─────────────────────────────────────────────────
     These were sidebar rows: twenty-odd of them, a second copy of the filters
     this screen already owns. They belong beside the list they filter, so the
     sidebar can stay a short list of areas. Still `?folder=` links — each one
     is shareable, refreshable and back-button-able exactly as before. */
  const chipStyle = (active: boolean, tone?: string): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '5px 10px', borderRadius: '99px', textDecoration: 'none',
    border: '1px solid ' + (active ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))'),
    background: active ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))',
    color: active ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-subtle))',
    fontSize: '.75rem', fontWeight: active ? 600 : 500, whiteSpace: 'nowrap',
    borderLeft: tone ? '3px solid ' + tone : undefined,
  });
  const chipCount: CSSProperties = {
    fontSize: '.65625rem', color: TEXT_MUTED,
    fontFamily: 'var(--font-sans)',
  };
  const countOf = (key: string): number | null => {
    const map: Record<string, number | undefined> = {
      documents: counts.all, templates: counts.templates,
      archive: counts.archived, trash: counts.trashed,
      inbox: counts.inbox, outbox: counts.outbox, drafts: counts.drafts,
      completed: counts.completed, expiring: counts.expiring,
      favorites: counts.favorites, shared: counts.shared, mine: counts.mine,
    };
    return key in map ? (map[key] ?? null) : null;
  };
  const folderChips = DOCUMENT_FOLDERS
    .map(([id, label]) => ({ id, label, tone: undefined as string | undefined }))
    .concat(folderOptions.map(f => ({ id: f.id, label: f.name, tone: undefined })));
  const viewChips = DOCUMENT_VIEWS.map(([id, label, tone]) => ({ id, label, tone }));
  const chipRow = (
    key: string,
    title: string,
    items: { id: string; label: string; tone?: string }[],
    countFor: (id: string) => string,
  ) => (
    <div key={key} aria-label={title} style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
      {items.map(item => {
        const active = filters.folder === item.id;
        const count = countFor(item.id);
        return (
          <Link key={item.id} href={folderHref(item.id)} aria-current={active ? 'page' : undefined} style={chipStyle(active, item.tone)}>
            <span>{item.label}</span>
            {count ? <span style={chipCount}>{count}</span> : null}
          </Link>
        );
      })}
    </div>
  );

  const hasLibSelection = s.libSelected.length > 0;
  const libSelectedLabel = s.libSelected.length ? s.libSelected.length + ' selected' : '';

  /* Every row currently on screen — what "select all" applies to. */
  const libRowIds = libRows.map(r => r.uid);
  const allSelected = libRowIds.length > 0 && libRowIds.every(id => s.libSelected.indexOf(id) > -1);
  const someSelected = !allSelected && libRowIds.some(id => s.libSelected.indexOf(id) > -1);
  const toggleSelectAll = () => set(st => ({
    libSelected: allSelected
      ? st.libSelected.filter(id => libRowIds.indexOf(id) === -1)
      : st.libSelected.concat(libRowIds.filter(id => st.libSelected.indexOf(id) === -1)),
  }));
  const checkboxStyle = (on: boolean, partial = false): CSSProperties => ({
    width: '17px', height: '17px', borderRadius: '5px', cursor: 'pointer', flex: '0 0 17px', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '.6875rem', lineHeight: 1, fontWeight: 700,
    border: '1px solid ' + (on || partial ? A : 'hsl(var(--color-border-strong))'),
    background: on || partial ? A : 'hsl(var(--color-bg-surface))',
    color: 'hsl(var(--color-fg-on-solid))',
  });

  const bulkRun = (optimistic: string, call: () => Promise<ApiResult<unknown>>) => {
    flash(optimistic);
    void call().then(res => {
      set({ libSelected: [] });
      if (!res.ok) { flash('Could not complete · ' + res.error.message); return; }
      router.refresh();
    });
  };

  /* The bulk bar's counterpart to `confirmRun` — same question, asked of a
     whole selection, and the same clearing of it once the call settles. */
  const confirmBulk = (
    opts: AskConfirmOptions,
    optimistic: string,
    call: () => Promise<ApiResult<unknown>>,
  ) => {
    void askConfirm(opts).then(ok => { if (ok) bulkRun(optimistic, call); });
  };

  const downloadSelection = (ids: string[]) => {
    flash('Download — ' + ids.length + ' item(s)');
    // The proxy streams the zip's bytes and `content-disposition` through, so
    // the browser can fetch `POST /api/documents/bulk-download` directly.
    void apiDownload(documentsApi.bulkDownloadPath(), {
      method: 'POST',
      body: { document_ids: ids },
      filename: 'documents.zip',
    }).then(res => {
      set({ libSelected: [] });
      if (!res.ok) { flash('Could not complete · ' + res.error.message); return; }
      saveBlob(res.data);
    });
  };

  const libBulk = ['Move', 'Archive', 'Download', 'Delete'].map(label => ({
    label,
    onClick: () => {
      const ids = s.libSelected.slice();
      const suffix = ' — ' + ids.length + ' item(s)';
      if (isTemplateFolder) { flash(label + suffix); set({ libSelected: [] }); return; }
      if (label === 'Download') { downloadSelection(ids); return; }
      if (label === 'Move') {
        void askFolder(ids.length + ' document(s)').then(target => {
          if (!target) return;
          bulkRun('Moved to ' + target.name + suffix,
            () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'move', folder_id: target.id }));
        });
        return;
      }
      const count = ids.length + ' document' + (ids.length === 1 ? '' : 's');
      if (label === 'Archive') {
        if (isArchiveFolder) {
          bulkRun('Unarchived' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'unarchive' }));
          return;
        }
        if (isTrashFolder) {
          bulkRun('Restored' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'restore' }));
          return;
        }
        confirmBulk(
          {
            title: 'Archive ' + count + '?',
            message: 'They move to Archive. You can unarchive them from there.',
            cta: 'Archive', danger: true,
          },
          'Archived' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'archive' }));
        return;
      }
      if (isTrashFolder) {
        confirmBulk(
          {
            title: 'Delete ' + count + ' permanently?',
            message: 'They will be erased. This cannot be undone.',
            cta: 'Delete permanently', danger: true,
          },
          'Deleted permanently' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'purge' }));
        return;
      }
      confirmBulk(
        {
          title: 'Move ' + count + ' to Trash?',
          message: 'They move to Trash. You can restore them from there.',
          cta: 'Move to Trash', danger: true,
        },
        'Moved to Trash' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'delete' }));
    },
    style: btn('hsl(var(--color-bg-surface))', label === 'Delete' ? 'hsl(var(--color-fg-danger))' : 'hsl(var(--color-fg-subtle))', label === 'Delete' ? 'hsl(var(--color-border-danger))' : 'hsl(var(--color-border-subtle))'),
  }));

  /* `libView` used to tint these two buttons and nothing else — Grid was a
     dead toggle. The card below is the same row's data in a tile: thumb,
     title, meta, status, and the one primary action plus its menu. */
  const isGrid = s.libView === 'grid';

  const libListBtn = btn(
    s.libView === 'list' ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))',
    s.libView === 'list' ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-subtle))',
    s.libView === 'list' ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))');
  const libGridBtn = btn(
    s.libView === 'grid' ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))',
    s.libView === 'grid' ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-subtle))',
    s.libView === 'grid' ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))');

  return (
    <section data-screen-label="Documents" style={{ display: 'flex', minHeight: '100%', alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0, padding: '18px 20px 40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.0625rem', fontWeight: 700, letterSpacing: '-.3px' }}>{libFolderLabel}</h2>
            <span style={{ fontSize: '.75rem', color: 'hsl(var(--color-fg-muted))', fontFamily: 'var(--font-sans)' }}>{libCountLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: '7px', flex: '0 0 auto' }}>
            {isTemplateFolder ? (
              <button type="button" onClick={() => setShowCatalog(true)} style={ghostBtn}><Icon name="search" size={13} />Browse form catalog</button>
            ) : null}
            <button type="button" onClick={createFolder} style={ghostBtn}><Icon name="plus" size={13} />New folder</button>
            {/* The picker is here, not on the builder: a draft with no PDF is
                nothing the user can prepare, so the file comes first. */}
            <UploadDocument />
          </div>
        </div>

        {/* Folders and views are the same kind of control — one destination
            each — so they share one row. Two labelled rows spent a third of
            the viewport restating that. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
          {chipRow('folders', 'Folders', folderChips, id => {
            const known = countOf(id);
            if (known !== null) return badge(known);
            const real = folderOptions.find(f => f.id === id);
            return badge(real ? real.documentCount : null);
          })}
          <span aria-hidden="true" style={{ width: '1px', alignSelf: 'stretch', minHeight: '18px', background: 'hsl(var(--color-border-subtle))', margin: '0 2px' }} />
          {chipRow('views', 'Views', viewChips, id => badge(countOf(id)))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Four always-open selects reading "All …" told the user nothing.
              They fold away until asked for, and the button carries how many
              are actually narrowing the list. */}
          <button
            type="button"
            aria-expanded={showFilters}
            onClick={() => setShowFilters(v => !v)}
            style={btn(
              activeFilterCount ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))',
              activeFilterCount ? 'hsl(var(--color-accent-fg))' : 'hsl(var(--color-fg-subtle))',
              activeFilterCount ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))')}
          >{activeFilterCount ? 'Filters · ' + activeFilterCount : 'Filters'}</button>
          <input
            type="search"
            value={queryDraft}
            onChange={e => setQueryDraft(e.target.value)}
            placeholder="Search documents and forms"
            aria-label="Search documents"
            style={{ height: '30px', flex: '1 1 200px', maxWidth: '320px', minWidth: '160px', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '9px', padding: '0 10px', fontSize: '.78125rem', outline: 'none', background: 'hsl(var(--color-bg-surface))' }}
          />
          <select
            value={filters.sort}
            onChange={e => pushFilters({ sort: e.target.value })}
            aria-label="Sort"
            style={{ height: '30px', marginLeft: 'auto', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '9px', padding: '0 9px', fontSize: '.75rem', background: 'hsl(var(--color-bg-surface))', color: 'hsl(var(--color-fg-subtle))', outline: 'none' }}
          >
            {libSortOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => set({ libView: 'list' })} style={libListBtn}><Icon name="distribute" size={12} />List</button>
          <button type="button" onClick={() => set({ libView: 'grid' })} style={libGridBtn}><Icon name="grid" size={12} />Grid</button>
        </div>

        {showFilters ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {libFilters.map(f => (
              <select key={f.key} value={f.value} onChange={f.onChange} style={f.style} aria-label="Filter">
                {f.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            ))}
            {filters.time === 'custom' ? (
              <>
                <label style={dateFieldLabel}>
                  <span>From</span>
                  <input
                    type="date"
                    value={filters.from}
                    max={filters.to || undefined}
                    onChange={e => pushFilters({ from: e.target.value })}
                    style={filterSelectStyle}
                  />
                </label>
                <label style={dateFieldLabel}>
                  <span>To</span>
                  <input
                    type="date"
                    value={filters.to}
                    min={filters.from || undefined}
                    onChange={e => pushFilters({ to: e.target.value })}
                    style={filterSelectStyle}
                  />
                </label>
              </>
            ) : null}
            {activeFilterCount || queryDraft ? (
              <button
                type="button"
                onClick={() => { setQueryDraft(''); pushFilters({ status: 'all', type: 'all', time: 'all', from: '', to: '', owner: 'all', q: '' }); }}
                style={linkBtn(A)}
              ><Icon name="refresh" size={11} />Reset filters</button>
            ) : null}
          </div>
        ) : null}

        {hasLibSelection ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px', border: '1px solid hsl(var(--color-accent-border))', background: 'hsl(var(--color-accent-subtle))', borderRadius: '11px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.78125rem', fontWeight: 600, color: 'hsl(var(--color-accent-fg))' }}>{libSelectedLabel}</span>
            <button type="button" onClick={toggleSelectAll} style={linkBtn(A)}>
              <Icon name="checkbox" size={11} />{allSelected ? 'Deselect all' : 'Select all ' + libRowIds.length}
            </button>
            <button type="button" onClick={() => set({ libSelected: [] })} style={linkBtn('hsl(var(--color-fg-muted))')}><Icon name="close" size={11} />Clear</button>
            <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
              {libBulk.map(b => (
                <button key={b.label} type="button" onClick={b.onClick} style={b.style}><Icon name={markFor(b.label)} size={12} />{b.label}</button>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '16px', overflow: 'visible' }}>
          {libRows.length === 0 ? (
            <div style={{ padding: '28px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '.84375rem', fontWeight: 600, color: 'hsl(var(--color-fg-default))' }}>
                {isTemplateFolder ? 'No templates yet' : 'Nothing in ' + libFolderLabel}
              </span>
              <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
                {isTemplateFolder
                  ? 'Add a ready-made form from the catalog, or save a prepared document as a template.'
                  : 'Upload a document or clear the filters above.'}
              </span>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                {isTemplateFolder ? (
                  <button type="button" onClick={() => setShowCatalog(true)} style={primaryBtn}><Icon name="search" size={13} />Browse form catalog</button>
                ) : (
                  <UploadDocument label="Upload a file" />
                )}
              </div>
            </div>
          ) : null}
          {libRows.length ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 14px', borderBottom: '1px solid hsl(var(--color-border-hairline))' }}>
              <button
                type="button"
                role="checkbox"
                aria-checked={allSelected ? 'true' : someSelected ? 'mixed' : 'false'}
                aria-label={allSelected ? 'Deselect all documents' : 'Select all documents'}
                onClick={toggleSelectAll}
                style={checkboxStyle(allSelected, someSelected)}
              >{allSelected ? <Icon name="check" size={11} /> : someSelected ? <Icon name="minus" size={11} /> : null}</button>
              <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
                {allSelected ? 'All ' + libRowIds.length + ' on this page selected' : 'Select all on this page'}
              </span>
            </div>
          ) : null}
          <div style={isGrid ? {
            display: 'grid', gap: '12px', padding: '12px 14px',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          } : undefined}>
          {libRows.map(d => (
            <div key={d.id} style={isGrid ? d.cardStyle : d.rowStyle}>
              <div style={isGrid
                ? { display: 'flex', alignItems: 'center', gap: '10px', alignSelf: 'stretch' }
                : { display: 'contents' }}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={d.checked === 'true'}
                  aria-label="Select"
                  onClick={d.onCheck}
                  style={checkboxStyle(d.checked === 'true')}
                >{d.checked === 'true' ? <Icon name="check" size={11} /> : null}</button>
                <span style={d.thumb}>
                  <span style={d.line1} /><span style={d.line2} /><span style={d.line3} /><span style={d.line4} />
                </span>
              </div>
              <div style={isGrid
                ? { display: 'flex', flexDirection: 'column', gap: '5px', alignSelf: 'stretch', minWidth: 0 }
                : { display: 'flex', flexDirection: 'column', gap: '5px', flex: '1 1 240px', minWidth: '200px' }}>
                <button
                  type="button"
                  onClick={d.onOpen}
                  onDoubleClick={d.onFavorite}
                  style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: '.84375rem', fontWeight: 600, color: 'hsl(var(--color-fg-default))', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >{d.title}</button>
                <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.meta}</span>
                <span style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={d.pillStyle}>{d.statusLabel}</span>
                  <span style={{ fontSize: '.6875rem', color: 'hsl(var(--color-fg-muted))' }}>{d.signers}</span>
                </span>
              </div>
              <div style={isGrid
                ? { display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'stretch', marginTop: 'auto' }
                : { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                <button type="button" onClick={d.onPrimary} style={isGrid ? { ...primaryBtn, flex: 1 } : primaryBtn}><Icon name={markFor(d.primaryLabel)} size={13} />{d.primaryLabel}</button>
                {/* One menu is open at a time, so the row showing it is the
                    one that holds the placement anchor. */}
                <div style={{ position: 'relative' }} ref={d.menuOpen ? menuAnchor : undefined}>
                  <button
                    type="button"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={d.menuOpen}
                    onClick={d.onMenu}
                    style={d.menuBtn}
                  ><Icon name="caretDown" size={13} /></button>
                  {d.menuOpen ? (
                    <div
                      role="menu"
                      data-sf-scroll="1"
                      style={{ position: 'absolute', right: 0, width: '230px', background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '12px', boxShadow: '0 18px 40px -18px rgba(15,23,42,.35)', padding: '6px', zIndex: 30, animation: 'sfIn .12s ease', ...menuStyle }}
                    >
                      {d.actions.map(ac => (
                        <button key={ac.label} type="button" role="menuitem" onClick={ac.onClick} style={ac.style}><Icon name={markFor(ac.label)} size={12} />{ac.label}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
      {showCatalog ? <CatalogBrowser onClose={() => setShowCatalog(false)} /> : null}
    </section>
  );
}
