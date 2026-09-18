'use client';

/**
 * Create a custom catalog form, or edit an existing one's details.
 *
 * One dialog for both: the fields are the same metadata either way, and a
 * separate edit dialog would be the same form with two inputs removed and a
 * different verb. Two things differ in edit mode, both because the entry
 * already exists — the handle is fixed (documents authored for the form
 * record it in `source_catalog_slug`, so changing it would orphan them), and
 * the PDF is not asked for (the row's own "Replace PDF" does that).
 *
 * Two calls, deliberately in this order: the entry is created first, then the
 * PDF is attached to it. If the upload fails the entry survives as "Needs a
 * PDF" — a real, recoverable state the screen already knows how to show —
 * rather than being rolled back and losing the metadata the curator just
 * typed. The dialog says so instead of pretending the whole thing failed.
 *
 * Field placement is not asked for here. It is drawn in the document builder
 * afterwards ("Place fields"), which is the editor that already exists.
 */

import { useCallback, useRef, useState } from 'react';
import { apiCall } from '@/lib/api/browser';
import { platformCatalog as catalogApi } from '@/lib/api/resources';
import type { CatalogCategory, CatalogTemplateResponse } from '@/lib/api/types';
import { useSF } from '@/lib/sf/state';
import { useModalBehaviour } from '@/components/sf/useModalBehaviour';
import { btn, inputStyle, lbl, TEXT_MUTED } from '@/lib/sf/ui';
import { MAX_UPLOAD_BYTES, UPLOAD_ACCEPT, isSupportedUpload, titleFromFilename } from '@/lib/sf/uploads';
import Icon from '@/components/sf/Icon';

const CATEGORIES: [CatalogCategory, string][] = [
  ['government', 'Government'],
  ['legal', 'Legal'],
  ['hr', 'HR'],
  ['finance', 'Finance'],
  ['real_estate', 'Real estate'],
  ['health', 'Health'],
  ['other', 'Other'],
];

/** The server accepts `^[a-z0-9]+(?:-[a-z0-9]+)*$`; mirror it rather than 422. */
function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export type CatalogFormDialogProps = {
  /** Omitted to create; given to edit that entry's details in place. */
  entry?: CatalogTemplateResponse | null;
  onClose: () => void;
  /** Called once the entry exists (or was updated), whether or not a PDF attached. */
  onSaved: () => void;
};

export default function CatalogFormDialog({ entry = null, onClose, onSaved }: CatalogFormDialogProps) {
  const { flash, accent } = useSF();
  const A = accent();
  const close = useCallback(() => onClose(), [onClose]);
  const dialogRef = useModalBehaviour<HTMLDivElement>(true, close);

  const editing = entry !== null;
  const [title, setTitle] = useState(entry?.title ?? '');
  const [slug, setSlug] = useState(entry?.slug ?? '');
  /* The slug follows the title until the curator types one of their own —
     after that it is theirs, and retyping the title must not overwrite it.
     An existing entry's handle is fixed, so it never follows. */
  const slugEdited = useRef(editing);
  const [description, setDescription] = useState(entry?.description ?? '');
  const [category, setCategory] = useState<CatalogCategory>(entry?.category ?? 'government');
  const [authority, setAuthority] = useState(entry?.authority ?? '');
  const [jurisdiction, setJurisdiction] = useState(entry?.jurisdiction ?? '');
  const [revision, setRevision] = useState(entry?.form_revision ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onTitle = useCallback((value: string) => {
    setTitle(value);
    if (!slugEdited.current) setSlug(slugify(value));
  }, []);

  const onFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!chosen) return;
    if (!isSupportedUpload(chosen.name)) {
      setError('That file type cannot be uploaded — try a PDF, an image, or a document such as .docx');
      return;
    }
    if (chosen.size > MAX_UPLOAD_BYTES) {
      setError('That file is too large — the limit is 25 MB');
      return;
    }
    setError(null);
    setFile(chosen);
    // A form usually is its filename; the curator can still overwrite it.
    if (!title.trim()) onTitle(titleFromFilename(chosen.name));
  }, [onTitle, title]);

  const submit = useCallback(() => {
    const name = title.trim();
    if (!name) { setError('Give the form a title'); return; }

    const metadata = {
      title: name,
      description: description.trim() || null,
      category,
      authority: authority.trim() || null,
      jurisdiction: jurisdiction.trim() || null,
      form_revision: revision.trim() || null,
    };

    setSaving(true);
    setError(null);

    if (entry) {
      /* Details only. The handle, the PDF and the field placement each have
         their own action, so none of them can be changed out from under the
         curator by editing a description. */
      void catalogApi.update(apiCall, entry.id, metadata).then(res => {
        setSaving(false);
        if (!res.ok) { setError(res.error.message); return; }
        flash(name + ' updated');
        onSaved();
      });
      return;
    }

    const handle = slugify(slug || title);
    if (!handle) { setSaving(false); setError('Give the form a handle — letters and numbers'); return; }

    void catalogApi
      .create(apiCall, {
        ...metadata,
        slug: handle,
        // Placement comes later, in the builder.
        roles: [],
        fields: [],
        published: false,
      })
      .then(created => {
        if (!created.ok) {
          setSaving(false);
          setError(created.error.message);
          return;
        }
        if (!file) {
          setSaving(false);
          flash(name + ' created — upload its PDF next');
          onSaved();
          return;
        }
        void catalogApi.uploadFile(apiCall, created.data.id, file).then(uploaded => {
          setSaving(false);
          // The entry exists either way; say which happened rather than
          // implying nothing was created.
          flash(uploaded.ok
            ? name + ' created'
            : name + ' created, but its PDF did not upload · ' + uploaded.error.message);
          onSaved();
        });
      });
  }, [authority, category, description, entry, file, flash, jurisdiction, onSaved, revision, slug, title]);

  const field = { display: 'flex', flexDirection: 'column' as const, gap: '5px' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-form-title"
        style={{
          background: '#fff', borderRadius: '16px', border: '1px solid #e3e7ee',
          width: 'min(620px, 100%)', maxHeight: 'min(88vh, 900px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #eef1f6' }}>
          <h2 id="new-form-title" style={{ margin: 0, fontSize: '.9375rem', fontWeight: 600, color: '#0f172a' }}>
            {editing ? 'Form details' : 'New catalog form'}
          </h2>
          <p style={{ margin: '3px 0 0', fontSize: '.75rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
            {editing
              ? 'How the form is described and filed. Its PDF and its field placement each have their own action.'
              : 'Describe the form and attach its PDF. You place the signature and data fields afterwards, in the builder.'}
          </p>
        </div>

        <div style={{ overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
          <label style={field}>
            <span style={lbl}>Title</span>
            <input
              value={title}
              onChange={event => onTitle(event.target.value)}
              placeholder="IRS Form W-9"
              style={inputStyle}
            />
          </label>

          <label style={field}>
            <span style={lbl}>Handle</span>
            <input
              value={slug}
              onChange={event => { slugEdited.current = true; setSlug(event.target.value); }}
              placeholder="irs-w9"
              readOnly={editing}
              style={{ ...inputStyle, ...(editing ? { background: '#f5f6f8', color: TEXT_MUTED } : null) }}
            />
            <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
              {editing
                ? 'Fixed once the form exists — drafts authored for it refer to this handle.'
                : 'Identifies the form across releases. Lowercase letters, numbers and hyphens.'}
            </span>
          </label>

          <label style={field}>
            <span style={lbl}>Description</span>
            <textarea
              value={description}
              onChange={event => setDescription(event.target.value)}
              rows={2}
              placeholder="What the form is for, and when a sender would reach for it."
              style={{ ...inputStyle, height: 'auto', padding: '8px 10px', resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap' }}>
            <label style={{ ...field, flex: '1 1 160px' }}>
              <span style={lbl}>Category</span>
              <select
                value={category}
                onChange={event => setCategory(event.target.value as CatalogCategory)}
                style={inputStyle}
              >
                {CATEGORIES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label style={{ ...field, flex: '1 1 160px' }}>
              <span style={lbl}>Issuing body</span>
              <input value={authority} onChange={e => setAuthority(e.target.value)} placeholder="IRS" style={inputStyle} />
            </label>
            <label style={{ ...field, flex: '1 1 120px' }}>
              <span style={lbl}>Jurisdiction</span>
              <input value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} placeholder="US" style={inputStyle} />
            </label>
            <label style={{ ...field, flex: '1 1 160px' }}>
              <span style={lbl}>Form revision</span>
              {/* The publisher's own revision, not our row version — it is how
                  a curator tells two editions of the same form apart. */}
              <input value={revision} onChange={e => setRevision(e.target.value)} placeholder="Rev. October 2018" style={inputStyle} />
            </label>
          </div>

          {editing ? null : (
          <label style={field}>
            <span style={lbl}>Form PDF</span>
            <input type="file" accept={UPLOAD_ACCEPT} onChange={onFile} style={{ ...inputStyle, height: 'auto', padding: '6px' }} />
            <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
              {file
                ? file.name
                : 'Optional now — the form stays unpublished until a PDF is attached.'}
            </span>
          </label>
          )}

          {error ? (
            <p role="alert" style={{ margin: 0, fontSize: '.71875rem', color: '#b91c1c', fontFamily: 'var(--font-sans)' }}>
              {error}
            </p>
          ) : null}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #eef1f6', display: 'flex', gap: '7px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={close} style={btn('#fff', '#475569', '#e3e7ee')}><Icon name="close" size={13} />Cancel</button>
          <button type="button" onClick={submit} disabled={saving} style={{ ...btn(A, '#fff', A), opacity: saving ? 0.6 : 1 }}>
            <Icon name={editing ? 'save' : 'plus'} size={13} />{saving ? 'Saving…' : editing ? 'Save details' : 'Create form'}
          </button>
        </div>
      </div>
    </div>
  );
}
