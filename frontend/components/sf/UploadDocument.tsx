'use client';

/* SignForge — the document upload entry point.
 *
 * `POST /api/documents/{id}/upload-pdf` has always existed on the backend, but
 * nothing in the UI ever opened a file picker: the library's "Upload & prepare"
 * button jumped straight to an empty builder, which then told the user to
 * "upload a PDF from the documents list". This component is that missing step.
 *
 * Two shapes, one flow:
 *
 *  - `documentId` omitted → create the draft first (`POST /api/documents`,
 *    titled after the file) and then upload into it, so the picker is the only
 *    thing the user has to touch. A failed upload trashes the draft it just
 *    created rather than leaving a fileless envelope in the library.
 *  - `documentId` given → upload into that existing envelope (the builder's
 *    "no PDF yet" state).
 *
 * On success we route to `/documents/{id}/prepare`; the server component there
 * refetches, so no client cache has to be invalidated.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/api/browser';
import { documents as documentsApi } from '@/lib/api/resources';
import { documentPathFor } from '@/lib/sf/routes';
import { useSF } from '@/lib/sf/state';
import { btn, TEXT_MUTED } from '@/lib/sf/ui';

/** Mirrors `settings.max_upload_bytes` — checked here so a 40 MB file is
 *  refused before it is pushed over the wire only to come back a 413. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** `Master services agreement.pdf` → `Master services agreement`. */
function titleFromFilename(name: string): string {
  const stripped = name.replace(/\.pdf$/i, '').trim();
  return (stripped || 'Untitled document').slice(0, 200);
}

export type UploadDocumentProps = {
  /** Upload into this envelope. Omitted, a draft is created for the file. */
  documentId?: string;
  label?: string;
  /** `primary` for the library's header action, `ghost`/`link` elsewhere. */
  variant?: 'primary' | 'ghost' | 'link';
};

export default function UploadDocument({ documentId, label = 'Upload & prepare', variant = 'primary' }: UploadDocumentProps) {
  const { flash, accent } = useSF();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const statusId = useId();
  const A = accent();

  const style = variant === 'primary'
    ? btn(A, '#fff', A)
    : variant === 'ghost'
      ? btn('#fff', '#475569', '#e3e7ee')
      : btn('transparent', A, 'transparent');

  const onPick = useCallback(async (file: File | null | undefined) => {
    if (!file || busy) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      flash('Only PDF files can be uploaded');
      return;
    }
    if (file.size === 0) { flash('That file is empty'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { flash('That PDF is larger than 25 MB'); return; }

    setBusy(true);
    try {
      let targetId = documentId ?? null;
      /* Only the create-then-upload path may clean up after itself: an upload
         into an envelope the user already owns must never delete it. */
      let createdId: string | null = null;
      if (!targetId) {
        const created = await documentsApi.create(apiCall, { title: titleFromFilename(file.name) });
        if (!created.ok) { flash(created.error.message); return; }
        targetId = created.data.id;
        createdId = created.data.id;
      }

      const uploaded = await documentsApi.uploadPdf(apiCall, targetId, file);
      if (!uploaded.ok) {
        if (createdId) await documentsApi.remove(apiCall, createdId);
        flash(uploaded.error.message);
        return;
      }

      flash(`Uploaded — ${uploaded.data.page_count} page${uploaded.data.page_count === 1 ? '' : 's'}`);
      router.push(documentPathFor('builder', uploaded.data.document.id));
      router.refresh();
    } finally {
      setBusy(false);
      // Let the same file be re-picked after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [busy, documentId, flash, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-describedby={busy ? statusId : undefined}
        style={Object.assign({}, style, busy ? { opacity: .65, cursor: 'progress' } : null)}
      >
        {busy ? 'Uploading…' : label}
      </button>
      {busy ? (
        <span id={statusId} role="status" style={{ fontSize: '.71875rem', color: TEXT_MUTED }}>
          Uploading your PDF…
        </span>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={e => { void onPick(e.target.files?.[0]); }}
        aria-label="Choose a PDF to upload"
        // Off-screen rather than `display:none` so it stays reachable to AT.
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', border: 0 }}
      />
    </>
  );
}
