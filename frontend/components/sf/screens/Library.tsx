'use client';

/* SignForge — DOCUMENT LIBRARY screen (isDash). Ported verbatim from the prototype.
 *
 * Data comes from `app/(app)/documents/page.tsx` (props); the filters, the
 * search box, the selection and the open row menu stay in `lib/sf/state.tsx`.
 * Every filter is mirrored into the URL so the server page refetches — the
 * markup below is untouched apart from an empty-state branch the prototype's
 * always-populated mock never needed. */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import type { ScreenKey } from '@/lib/sf/routes';
import { btn, pill, linkBtn } from '@/lib/sf/ui';
import {
  QUICK_ACCESS, LIB_FOLDERS, LIB_FILTER_DEFS, LIB_SORT_OPTIONS, ROW_ACTIONS,
  STATUS,
} from '@/lib/sf/data';
import { apiCall } from '@/lib/api/browser';
import type { ApiResult } from '@/lib/api/result';
import { documents as documentsApi, templates as templatesApi } from '@/lib/api/resources';
import {
  libraryFiltersToQuery, libraryFolderLabel,
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
  /** `GET /api/folders/tree`, flattened — the "Move to folder" targets. */
  folderOptions: FolderOption[];
  /** The filters the URL asked for, so a shared link seeds the selects. */
  initialFilters: LibraryFilters;
  /** `POST /api/documents/bulk-download` (a zip, so it runs server-side). */
  bulkDownload: (documentIds: string[]) =>
    Promise<{ ok: true; filename: string; base64: string } | { ok: false; message: string }>;
};

/** Row actions the design lists that no endpoint backs yet — they stay toasts. */
const UNBACKED_ACTIONS = new Set([
  'Email a copy', 'Create invite link', 'Freeform invite', 'Notarize', 'Quick preview',
  'Share', 'Download', 'Download with certificate', 'Print', 'Export to cloud',
  'Merge document with…',
]);

export default function Library(props: LibraryProps) {
  const { rows, total, templates, templateTotal, folderOptions, initialFilters, bulkDownload } = props;
  const { s, set, flash, accent } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const searchParams = useSearchParams();
  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  /* ── filters ⇄ URL ─────────────────────────────────────────────────────
     The selects write to the store as before; the store is mirrored into the
     query string, which is what the server page reads. Typing is debounced so
     a search does one refetch, not one per keystroke. */
  const seeded = useRef(false);
  const [seedApplied, setSeedApplied] = useState(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setSeedApplied(true);
    set({
      libFolder: initialFilters.folder,
      libStatus: initialFilters.status,
      libType: initialFilters.type,
      libTime: initialFilters.time,
      libOwner: initialFilters.owner,
      libSort: initialFilters.sort,
      query: initialFilters.q,
    });
  }, [initialFilters, set]);

  const [debouncedQuery, setDebouncedQuery] = useState(initialFilters.q);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(s.query), 300);
    return () => clearTimeout(timer);
  }, [s.query]);

  const currentQuery = searchParams.toString();
  useEffect(() => {
    if (!seedApplied) return;
    const next = libraryFiltersToQuery({
      folder: s.libFolder, status: s.libStatus, type: s.libType, time: s.libTime,
      owner: s.libOwner, q: debouncedQuery, sort: s.libSort,
    });
    if (next.replace(/^\?/, '') === currentQuery) return;
    router.replace(`/documents${next}`, { scroll: false });
  }, [s.libFolder, s.libStatus, s.libType, s.libTime, s.libOwner, s.libSort, debouncedQuery, currentQuery, router, seedApplied]);

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

  const libFolderLabel = libraryFolderLabel(
    s.libFolder,
    (QUICK_ACCESS as [string, string, number, string][])
      .map(f => [f[0], f[1]] as [string, string])
      .concat(LIB_FOLDERS.map(f => [f[0], f[1]] as [string, string])),
    folderOptions,
  );

  const isTemplateFolder = s.libFolder === 'templates';
  const isArchiveFolder = s.libFolder === 'archive';
  const isTrashFolder = s.libFolder === 'trash';
  const libDocs = rows;

  const libCountLabel =
    (isTemplateFolder ? templateTotal : total) +
    (isTemplateFolder ? ' templates' : ' documents');

  const filterSelectStyle: CSSProperties = {
    height: '30px', border: '1px solid #e3e7ee', borderRadius: '9px', padding: '0 9px',
    fontSize: '12px', background: '#fff', color: '#334155', outline: 'none',
  };

  const libFilters = LIB_FILTER_DEFS.map(([key, opts]) => ({
    key,
    value: (s as unknown as Record<string, string>)[key],
    options: opts.map(([id, label]) => ({ id, label })),
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      set({ [key]: v } as never);
    },
    style: filterSelectStyle,
  }));

  const libSortOptions = LIB_SORT_OPTIONS.map(([id, label]) => ({ id, label }));

  const moveTarget = folderOptions[0] ?? null;

  const libRows = (isTemplateFolder ? templates : libDocs).map((d: any, i: number) => {
    const isTpl = isTemplateFolder;
    /** The real UUID — what the API takes. `d.id` stays the design's reference. */
    const uid: string = isTpl ? d.templateId : d.documentId;
    const st = isTpl ? STATUS.completed : STATUS[d.status];
    const checked = s.libSelected.indexOf(uid) > -1;

    /** Row action → endpoint. Everything in `UNBACKED_ACTIONS` keeps its toast. */
    const actionCall = (label: string): (() => void) | null => {
      if (isTpl) {
        switch (label) {
          case 'Make template':
          case 'Duplicate':
            return () => run('Template duplicated', () => templatesApi.duplicate(apiCall, uid));
          case 'Rename': {
            return () => {
              const title = window.prompt('Rename template', d.title);
              if (!title || title === d.title) return;
              run(title + ' renamed', () => templatesApi.update(apiCall, uid, { title }));
            };
          }
          case 'Move to folder':
            return moveTarget
              ? () => run('Moved to ' + moveTarget.name, () => templatesApi.update(apiCall, uid, { folder_id: moveTarget.id }))
              : () => flash('No folders yet — create one first');
          case 'Archive':
            return isArchiveFolder
              ? () => run(d.title + ' restored', () => templatesApi.restore(apiCall, uid))
              : () => run(d.title + ' archived', () => templatesApi.archive(apiCall, uid));
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
            const title = window.prompt('Rename document', d.title);
            if (!title || title === d.title) return;
            run(title + ' renamed', () => documentsApi.rename(apiCall, uid, title));
          };
        case 'Move to folder':
          return moveTarget
            ? () => run('Moved to ' + moveTarget.name, () => documentsApi.move(apiCall, uid, moveTarget.id))
            : () => flash('No folders yet — create one first');
        case 'Archive':
          if (isArchiveFolder) return () => run(d.title + ' unarchived', () => documentsApi.unarchive(apiCall, uid));
          if (isTrashFolder) return () => run(d.title + ' restored', () => documentsApi.restore(apiCall, uid));
          return () => run(d.title + ' archived', () => documentsApi.archive(apiCall, uid));
        case 'Delete':
          if (isTrashFolder) {
            return () => run(d.title + ' deleted permanently',
              () => documentsApi.bulk(apiCall, { document_ids: [uid], action: 'purge' }));
          }
          return () => run(d.title + ' moved to Trash', () => documentsApi.trash(apiCall, uid));
        default:
          return null;
      }
    };

    return {
      id: uid,
      title: d.title,
      checked: checked ? 'true' : 'false',
      meta: isTpl
        ? d.id + ' · ' + d.fields + ' fields · used ' + d.uses + '× · updated ' + d.updated
        : d.id + ' · ' + d.pages + ' pages · updated ' + d.updated,
      statusLabel: isTpl ? 'Template' : st.label,
      pillStyle: pill(isTpl ? { bg: '#eef2ff', fg: '#3730a3', bd: '#c7d2fe' } : st),
      signers: isTpl ? 'Owner ' + d.owner : 'Signers: ' + (d.total || 1),
      rowStyle: {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
        borderTop: i ? '1px solid #f2f4f8' : 'none',
        background: checked ? '#f8faff' : 'transparent', flexWrap: 'wrap',
      } as CSSProperties,
      onCheck: () => set(st2 => ({
        libSelected: checked ? st2.libSelected.filter(x => x !== uid) : st2.libSelected.concat([uid]),
      })),
      thumb: {
        width: '40px', height: '50px', borderRadius: '5px', background: '#fff',
        border: '1px solid #e3e7ee', flex: '0 0 40px', display: 'flex',
        flexDirection: 'column', gap: '3px', padding: '6px 5px', overflow: 'hidden',
      } as CSSProperties,
      line1: { height: '2px', background: '#cbd5e1', borderRadius: '2px' } as CSSProperties,
      line2: { height: '2px', background: '#e3e7ee', borderRadius: '2px', width: '82%' } as CSSProperties,
      line3: { height: '2px', background: '#e3e7ee', borderRadius: '2px', width: '64%' } as CSSProperties,
      line4: { height: '2px', background: '#e3e7ee', borderRadius: '2px', width: '74%' } as CSSProperties,
      onOpen: () => { set({ wizardStep: 1 }); go('builder'); },
      /* The design gives favourites no affordance of their own, so the row
         title carries the toggle on double-click until one is designed. */
      onFavorite: isTpl ? undefined : () => {
        if (d.isFavorite) run(d.title + ' removed from Favorites', () => documentsApi.unfavorite(apiCall, uid));
        else run(d.title + ' added to Favorites', () => documentsApi.favorite(apiCall, uid));
      },
      primaryLabel: isTpl ? 'Use template' : (d.status === 'draft' ? 'Prepare and send' : 'Invite to sign'),
      onPrimary: isTpl
        ? () => {
          flash('Document created from ' + d.title);
          void templatesApi.use(apiCall, uid).then(res => {
            if (!res.ok) { flash('Could not complete · ' + res.error.message); return; }
            set({ wizardStep: 1 });
            go('builder');
          });
        }
        : () => { set({ wizardStep: 1 }); go('builder'); },
      onTemplate: isTpl
        ? () => run('Template duplicated', () => templatesApi.duplicate(apiCall, uid))
        : () => run(d.title + ' saved as a template', () => documentsApi.makeTemplate(apiCall, uid)),
      menuOpen: s.menuDoc === uid,
      onMenu: (e: React.MouseEvent) => {
        e.stopPropagation();
        set({ menuDoc: s.menuDoc === uid ? null : uid });
      },
      menuBtn: {
        width: '28px', height: '28px', borderRadius: '8px', border: '1px solid #e3e7ee',
        background: '#fff', cursor: 'pointer', color: '#475569', fontSize: '13px',
        lineHeight: 1, flex: '0 0 28px',
      } as CSSProperties,
      actions: ROW_ACTIONS.map(([label, target]) => {
        const wired = UNBACKED_ACTIONS.has(label) ? null : actionCall(label);
        return {
          label,
          onClick: () => {
            set({ menuDoc: null, wizardStep: 1 });
            if (wired) { wired(); return; }
            if (target) go(target as ScreenKey);
            else flash(label + ' — ' + d.title);
          },
          style: {
            display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px',
            borderRadius: '7px', border: 'none', background: 'transparent', cursor: 'pointer',
            fontSize: '12.5px',
            color: (label === 'Delete' || label === 'Archive') ? '#b91c1c' : '#334155',
          } as CSSProperties,
        };
      }),
    };
  });

  const hasLibSelection = s.libSelected.length > 0;
  const libSelectedLabel = s.libSelected.length ? s.libSelected.length + ' selected' : '';

  const bulkRun = (optimistic: string, call: () => Promise<ApiResult<unknown>>) => {
    flash(optimistic);
    void call().then(res => {
      set({ libSelected: [] });
      if (!res.ok) { flash('Could not complete · ' + res.error.message); return; }
      router.refresh();
    });
  };

  const downloadSelection = (ids: string[]) => {
    flash('Download — ' + ids.length + ' item(s)');
    void bulkDownload(ids).then(res => {
      set({ libSelected: [] });
      if (!res.ok) { flash('Could not complete · ' + res.message); return; }
      const bytes = Uint8Array.from(atob(res.base64), ch => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = res.filename;
      anchor.click();
      URL.revokeObjectURL(url);
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
        if (!moveTarget) { flash('No folders yet — create one first'); set({ libSelected: [] }); return; }
        bulkRun('Moved to ' + moveTarget.name + suffix,
          () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'move', folder_id: moveTarget.id }));
        return;
      }
      if (label === 'Archive') {
        if (isArchiveFolder) {
          bulkRun('Unarchived' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'unarchive' }));
          return;
        }
        if (isTrashFolder) {
          bulkRun('Restored' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'restore' }));
          return;
        }
        bulkRun('Archived' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'archive' }));
        return;
      }
      if (isTrashFolder) {
        bulkRun('Deleted permanently' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'purge' }));
        return;
      }
      bulkRun('Moved to Trash' + suffix, () => documentsApi.bulk(apiCall, { document_ids: ids, action: 'delete' }));
    },
    style: btn('#fff', label === 'Delete' ? '#b91c1c' : '#475569', label === 'Delete' ? '#fecaca' : '#e3e7ee'),
  }));

  const libListBtn = btn(
    s.libView === 'list' ? '#eef2ff' : '#fff',
    s.libView === 'list' ? '#3730a3' : '#475569',
    s.libView === 'list' ? '#c7d2fe' : '#e3e7ee');
  const libGridBtn = btn(
    s.libView === 'grid' ? '#eef2ff' : '#fff',
    s.libView === 'grid' ? '#3730a3' : '#475569',
    s.libView === 'grid' ? '#c7d2fe' : '#e3e7ee');

  return (
    <section data-screen-label="Documents" style={{ display: 'flex', minHeight: '100%', alignItems: 'stretch' }}>
      <div style={{ flex: 1, minWidth: 0, padding: '18px 20px 40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, letterSpacing: '-.3px' }}>{libFolderLabel}</h2>
            <span style={{ fontSize: '12px', color: '#64748b', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{libCountLabel}</span>
          </div>
          <div style={{ display: 'flex', gap: '7px', flex: '0 0 auto' }}>
            <button type="button" onClick={() => flash('Folder created in ' + libFolderLabel)} style={ghostBtn}>New folder</button>
            <button type="button" onClick={() => go('builder')} style={primaryBtn}>Upload &amp; prepare</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {libFilters.map(f => (
            <select key={f.key} value={f.value} onChange={f.onChange} style={f.style} aria-label="Filter">
              {f.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          ))}
          <button
            type="button"
            onClick={() => set({ libStatus: 'all', libType: 'all', libTime: 'all', libOwner: 'all', query: '' })}
            style={linkBtn(A)}
          >Reset filters</button>
          <input
            type="search"
            value={s.query}
            onChange={e => set({ query: e.target.value })}
            placeholder="Search documents and forms"
            aria-label="Search documents"
            style={{ height: '30px', flex: 1, minWidth: '180px', border: '1px solid #e3e7ee', borderRadius: '9px', padding: '0 10px', fontSize: '12.5px', outline: 'none', background: '#fff' }}
          />
          <select
            value={s.libSort}
            onChange={e => set({ libSort: e.target.value })}
            aria-label="Sort"
            style={{ height: '30px', border: '1px solid #e3e7ee', borderRadius: '9px', padding: '0 9px', fontSize: '12px', background: '#fff', color: '#334155', outline: 'none' }}
          >
            {libSortOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => set({ libView: 'list' })} style={libListBtn}>List</button>
          <button type="button" onClick={() => set({ libView: 'grid' })} style={libGridBtn}>Grid</button>
        </div>

        {hasLibSelection ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '9px 12px', border: '1px solid #c7d2fe', background: '#eef2ff', borderRadius: '11px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#3730a3' }}>{libSelectedLabel}</span>
            <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
              {libBulk.map(b => (
                <button key={b.label} type="button" onClick={b.onClick} style={b.style}>{b.label}</button>
              ))}
            </div>
          </div>
        ) : null}

        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', overflow: 'visible' }}>
          {libRows.length === 0 ? (
            <div style={{ padding: '28px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#0f172a' }}>
                {isTemplateFolder ? 'No templates yet' : 'Nothing in ' + libFolderLabel}
              </span>
              <span style={{ fontSize: '11.5px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>
                {isTemplateFolder ? 'Save a prepared document as a template to reuse it.' : 'Upload a document or clear the filters above.'}
              </span>
            </div>
          ) : null}
          {libRows.map(d => (
            <div key={d.id} style={d.rowStyle}>
              <button
                type="button"
                role="checkbox"
                aria-checked={d.checked === 'true'}
                aria-label="Select"
                onClick={d.onCheck}
                style={{ width: '17px', height: '17px', borderRadius: '5px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', flex: '0 0 17px' }}
              />
              <span style={d.thumb}>
                <span style={d.line1} /><span style={d.line2} /><span style={d.line3} /><span style={d.line4} />
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: '1 1 240px', minWidth: '200px' }}>
                <button
                  type="button"
                  onClick={d.onOpen}
                  onDoubleClick={d.onFavorite}
                  style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: '13.5px', fontWeight: 600, color: '#0f172a', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                >{d.title}</button>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.meta}</span>
                <span style={{ display: 'flex', gap: '7px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={d.pillStyle}>{d.statusLabel}</span>
                  <span style={{ fontSize: '11px', color: '#64748b' }}>{d.signers}</span>
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' }}>
                <button type="button" onClick={d.onPrimary} style={primaryBtn}>{d.primaryLabel}</button>
                <button type="button" onClick={d.onTemplate} style={ghostBtn}>Make template</button>
                <div style={{ position: 'relative' }}>
                  <button
                    type="button"
                    aria-label="More actions"
                    aria-expanded={d.menuOpen}
                    onClick={d.onMenu}
                    style={d.menuBtn}
                  >···</button>
                  {d.menuOpen ? (
                    <div
                      role="menu"
                      data-sf-scroll="1"
                      style={{ position: 'absolute', right: 0, top: '32px', width: '230px', maxHeight: '320px', overflow: 'auto', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '12px', boxShadow: '0 18px 40px -18px rgba(15,23,42,.35)', padding: '6px', zIndex: 30, animation: 'sfIn .12s ease' }}
                    >
                      {d.actions.map(ac => (
                        <button key={ac.label} type="button" role="menuitem" onClick={ac.onClick} style={ac.style}>{ac.label}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
