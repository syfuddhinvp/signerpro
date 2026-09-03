'use client';

/**
 * The blank builder — where `/documents/prepare` lands.
 *
 * This route used to resolve "the newest draft" and redirect into it, so
 * "New envelope" / "Open builder" reopened whatever the user prepared last
 * instead of starting something new. An envelope has to exist before there is
 * anything to prepare, and the thing that creates one is a PDF: this screen is
 * that step, and `UploadDocument` routes to the real builder once the file is
 * in.
 */

import Link from 'next/link';
import type { CSSProperties } from 'react';
import UploadDocument from '@/components/sf/UploadDocument';
import { folderHref } from '@/lib/sf/navigation';
import { SCREEN_PATH } from '@/lib/sf/routes';
import { useSF } from '@/lib/sf/state';
import { btn, TEXT_MUTED } from '@/lib/sf/ui';

export default function NewEnvelope({ draftId }: { draftId: string | null }) {
  const A = useSF().accent();

  const cardStyle: CSSProperties = {
    background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px',
    padding: '30px 26px', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: '10px', textAlign: 'center',
  };
  const linkStyle: CSSProperties = { ...btn('#fff', '#475569', '#e3e7ee'), textDecoration: 'none' };

  return (
    <section data-screen-label="New envelope" style={{ padding: '22px 22px 40px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={cardStyle}>
        <span style={{ fontSize: '1.0625rem', fontWeight: 700, letterSpacing: '-.3px' }}>Start a new envelope</span>
        <span style={{ fontSize: '.78125rem', color: TEXT_MUTED, maxWidth: '440px' }}>
          Choose the PDF you want signed. It becomes a draft envelope you can add
          recipients and fields to — nothing is sent until you send it.
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <UploadDocument label="Choose a PDF" />
          <Link href={folderHref('templates')} style={linkStyle}>Start from a template</Link>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
        {/* The old behaviour, kept as a choice rather than a redirect. */}
        {draftId ? (
          <Link href={`/documents/${encodeURIComponent(draftId)}/prepare`} style={{ fontSize: '.78125rem', color: A, textDecoration: 'none' }}>
            Continue your most recent draft
          </Link>
        ) : null}
        <Link href={SCREEN_PATH.dashboard} style={{ fontSize: '.78125rem', color: TEXT_MUTED, textDecoration: 'none' }}>
          Back to documents
        </Link>
      </div>
    </section>
  );
}
