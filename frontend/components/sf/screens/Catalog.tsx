'use client';

/**
 * The platform form catalog, as a curator sees it.
 *
 * A catalog entry is a blueprint — roles and field boxes — and it is useless
 * to a tenant until the authoritative PDF sits behind it. So the screen is
 * built around that one gate: every row says whether it has a file, and an
 * entry cannot be published without one. That is why the built-in blueprints
 * seed unpublished; publishing one with no PDF would hand every tenant an
 * empty template.
 *
 * Deleting an entry is safe for tenants: an import is a copy, so a template
 * someone already added is untouched by anything that happens here.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/api/browser';
import { platformCatalog as catalogApi } from '@/lib/api/resources';
import type { CatalogCategory, CatalogTemplateResponse } from '@/lib/api/types';
import { useSF } from '@/lib/sf/state';
import { useDialogs } from '@/components/sf/DialogProvider';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import { btn, pill, TEXT_MUTED, TONE_GOOD, TONE_MUTED, TONE_WARN } from '@/lib/sf/ui';
import { documentPathFor } from '@/lib/sf/routes';
import CatalogFormDialog from '@/components/sf/CatalogFormDialog';
import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, isSupportedUpload } from '@/lib/sf/uploads';

export type CatalogProps = {
  /** `GET /api/platform/catalog-templates`, published and draft alike. */
  items: CatalogTemplateResponse[];
  /** `ApiError.message` when the server render failed, so `items` above is a
   *  substituted empty list rather than an empty catalog. */
  loadError?: string | null;
};

const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  government: 'Government',
  legal: 'Legal',
  hr: 'HR',
  finance: 'Finance',
  real_estate: 'Real estate',
  health: 'Health',
  other: 'Other',
};

export default function Catalog({ items, loadError }: CatalogProps) {
  const { flash, accent } = useSF();
  const { askConfirm } = useDialogs();
  const router = useRouter();
  const A = accent();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const dangerBtn = btn('#fff', '#b91c1c', '#fecaca');

  /** The entry whose file picker is open, so one hidden input serves every row. */
  const pendingUpload = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* null = closed. `'new'` creates; an entry opens its details for editing. */
  const [dialog, setDialog] = useState<'new' | CatalogTemplateResponse | null>(null);

  const run = useCallback(
    (id: string, optimistic: string, call: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
      setBusy(id);
      void call().then(res => {
        setBusy(null);
        if (!res.ok) { flash('Could not complete · ' + (res.error?.message ?? 'unknown error')); return; }
        flash(optimistic);
        router.refresh();
      });
    },
    [flash, router],
  );

  const pickFile = useCallback((id: string) => {
    pendingUpload.current = id;
    fileInput.current?.click();
  }, []);

  const onFileChosen = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const id = pendingUpload.current;
    // Clear immediately: picking the same file twice in a row must still fire
    // a change event.
    event.target.value = '';
    pendingUpload.current = null;
    if (!file || !id) return;

    /* Checked here as well as server-side so the curator learns before a
       25 MB upload rather than after it. */
    if (!isSupportedUpload(file.name)) {
      flash('That file type cannot be uploaded — try a PDF, an image, or a document such as .docx');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      flash('That file is too large — the limit is 25 MB');
      return;
    }
    run(id, file.name + ' attached', () => catalogApi.uploadFile(apiCall, id, file));
  }, [flash, run]);

  const togglePublish = useCallback((entry: CatalogTemplateResponse) => {
    if (!entry.published && !entry.has_file) {
      flash('Upload the form’s PDF before publishing — tenants would import an empty template');
      return;
    }
    run(
      entry.id,
      entry.published ? entry.title + ' withdrawn from tenants' : entry.title + ' published to tenants',
      () => catalogApi.publish(apiCall, entry.id, !entry.published),
    );
  }, [flash, run]);

  const remove = useCallback((entry: CatalogTemplateResponse) => {
    void askConfirm({
      title: 'Delete ' + entry.title + '?',
      message: 'Tenants who already imported this form keep their own copy — an import is a copy, not a link. New tenants will no longer see it.',
      cta: 'Delete',
      danger: true,
    }).then(yes => {
      if (!yes) return;
      run(entry.id, entry.title + ' deleted', () => catalogApi.remove(apiCall, entry.id));
    });
  }, [askConfirm, run]);

  /* Placement is authored in the ordinary document builder rather than in a
     second field editor built for this screen. The draft is a template in the
     curator's own organization; "Save to catalog" in the builder brings the
     placement back. */
  const placeFields = useCallback((entry: CatalogTemplateResponse) => {
    setBusy(entry.id);
    void catalogApi.draftTemplate(apiCall, entry.id).then(res => {
      setBusy(null);
      if (!res.ok) { flash('Could not open the builder · ' + res.error.message); return; }
      router.push(documentPathFor('builder', res.data.id));
    });
  }, [flash, router]);

  const seed = useCallback(() => {
    run('seed', 'Built-in blueprints added', () => catalogApi.seed(apiCall));
  }, [run]);

  if (loadError) return <ApiUnavailable what="The form catalog" detail={loadError} />;

  const published = items.filter(item => item.published).length;
  const missingFile = items.filter(item => !item.has_file).length;

  return (
    <section data-screen-label="Form catalog" style={{ padding: '18px 20px 40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <input
        ref={fileInput}
        type="file"
        accept={UPLOAD_ACCEPT}
        onChange={onFileChosen}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
          <span data-testid="catalog-summary" style={{ fontSize: '.75rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>
            {items.length} form{items.length === 1 ? '' : 's'} · {published} published
            {missingFile ? ' · ' + missingFile + ' waiting for a PDF' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
          <button type="button" onClick={seed} disabled={busy === 'seed'} style={ghostBtn}>
            {busy === 'seed' ? 'Adding…' : 'Add built-in blueprints'}
          </button>
          <button type="button" onClick={() => setDialog('new')} style={primaryBtn}>New form</button>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px', padding: '28px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '.84375rem', fontWeight: 600, color: '#0f172a' }}>No forms in the catalog yet</span>
          <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
            Add the built-in blueprints (W-9, I-9, W-4, mutual NDA, offer letter), then upload each form’s PDF and publish it.
          </span>
          <div style={{ marginTop: '6px', display: 'flex', gap: '7px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={seed} style={primaryBtn}>Add built-in blueprints</button>
            <button type="button" onClick={() => setDialog('new')} style={ghostBtn}>New form</button>
          </div>
        </div>
      ) : null}

      {items.map(entry => {
        const working = busy === entry.id;
        const tone = entry.published ? TONE_GOOD : entry.has_file ? TONE_WARN : TONE_MUTED;
        const state = entry.published ? 'Published' : entry.has_file ? 'Ready to publish' : 'Needs a PDF';
        return (
          <div
            key={entry.id}
            style={{
              background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '13px 14px',
              display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.84375rem', fontWeight: 600, color: '#0f172a' }}>{entry.title}</span>
                <span style={pill(tone)}>{state}</span>
              </div>
              {entry.description ? (
                <span style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>{entry.description}</span>
              ) : null}
              <span style={{ fontSize: '.6875rem', color: '#64748b', fontFamily: 'var(--font-sans)' }}>
                {[
                  CATEGORY_LABEL[entry.category] ?? entry.category,
                  entry.authority,
                  entry.jurisdiction,
                  entry.form_revision,
                  entry.slug,
                  entry.page_count === 1 ? '1 page' : entry.page_count + ' pages',
                  entry.role_count === 1 ? '1 role' : entry.role_count + ' roles',
                  entry.field_count === 1 ? '1 field' : entry.field_count + ' fields',
                ].filter(Boolean).join(' · ')}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={() => pickFile(entry.id)} disabled={working} style={entry.has_file ? ghostBtn : primaryBtn}>
                {working ? 'Working…' : entry.has_file ? 'Replace PDF' : 'Upload PDF'}
              </button>
              <button type="button" onClick={() => setDialog(entry)} disabled={working} style={ghostBtn}>Edit details</button>
              <button type="button" onClick={() => placeFields(entry)} disabled={working} style={ghostBtn}>
                {entry.field_count ? 'Edit fields' : 'Place fields'}
              </button>
              <button
                type="button"
                onClick={() => togglePublish(entry)}
                disabled={working}
                style={ghostBtn}
                /* Not `disabled` when the file is missing: a disabled control
                   cannot explain itself, and "why can't I publish this?" is
                   exactly what a curator needs answered. */
                title={!entry.published && !entry.has_file ? 'Upload the form’s PDF first' : undefined}
              >{entry.published ? 'Withdraw' : 'Publish'}</button>
              <button type="button" onClick={() => remove(entry)} disabled={working} style={dangerBtn}>Delete</button>
            </div>
          </div>
        );
      })}
      {dialog ? (
        <CatalogFormDialog
          entry={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); router.refresh(); }}
        />
      ) : null}
    </section>
  );
}
