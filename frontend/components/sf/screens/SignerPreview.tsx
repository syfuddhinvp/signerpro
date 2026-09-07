'use client';

/**
 * Preview chrome around the signer surface.
 *
 * `/documents/<id>/signer-view` renders the real recipient experience against
 * the real document, which is exactly what makes it useful before sending —
 * and exactly why it needs to announce itself. Without a frame saying so, a
 * sender who fills a field here reasonably expects it to stick; it does not.
 * So this wrapper says whose view it is, offers the way back to editing, and
 * states plainly that nothing typed here is saved.
 *
 * It is deliberately chrome only: the surface inside is the same `Signer` the
 * recipient gets, unmodified, so what you preview is what they receive.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useSF } from '@/lib/sf/state';
import { documentPathFor } from '@/lib/sf/routes';
import { BORDER_STRONG, TEXT_MUTED } from '@/lib/sf/ui';

export type PreviewRecipient = { id: string; name: string; role: string; fieldCount: number };

/** The widths the two viewports preview at. Mobile is a common phone width;
 *  desktop is unconstrained, the same as the recipient on a laptop. */
const MOBILE_WIDTH = 420;

export default function SignerPreview({
  documentId, recipients, selectedId, children,
}: {
  documentId: string;
  recipients: PreviewRecipient[];
  selectedId: string | null;
  children: ReactNode;
}) {
  const { accent } = useSF();
  const A = accent();
  const [mobile, setMobile] = useState(false);

  const backHref = documentPathFor('builder', documentId);
  const recipientHref = (id: string) =>
    documentPathFor('sign', documentId) + '?recipient=' + encodeURIComponent(id);

  const viewportBtn = (on: boolean): CSSProperties => ({
    height: '28px', padding: '0 11px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    fontSize: '.75rem', fontWeight: on ? 600 : 500,
    background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
    boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
  });

  const chip = (on: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 10px', borderRadius: '99px',
    border: '1px solid ' + (on ? '#c7d2fe' : '#e3e7ee'), background: on ? '#eef2ff' : '#fff',
    color: on ? '#0f172a' : '#475569', fontSize: '.75rem', fontWeight: on ? 600 : 500,
    textDecoration: 'none', whiteSpace: 'nowrap',
  });

  return (
    <section data-screen-label="Signer preview" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 16px', background: '#fff', borderBottom: '1px solid #e3e7ee' }}>
        <Link href={backHref} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.78125rem', fontWeight: 600, color: '#334155', textDecoration: 'none' }}>
          <span aria-hidden="true">‹</span> Back to editing
        </Link>

        {recipients.length ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.6875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>PREVIEW AS</span>
            {recipients.map(r => (
              <Link
                key={r.id}
                href={recipientHref(r.id)}
                aria-current={r.id === selectedId ? 'page' : undefined}
                style={chip(r.id === selectedId)}
              >
                <span style={{ width: '6px', height: '6px', borderRadius: '99px', background: r.id === selectedId ? A : BORDER_STRONG }}></span>
                {r.name}
                <span style={{ color: TEXT_MUTED, fontWeight: 500 }}>{r.fieldCount} fields</span>
              </Link>
            ))}
          </div>
        ) : null}

        <div role="group" aria-label="Preview viewport" style={{ marginLeft: 'auto', display: 'flex', gap: '4px', background: '#eceff4', padding: '4px', borderRadius: '10px' }}>
          <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)} style={viewportBtn(!mobile)}>Desktop</button>
          <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)} style={viewportBtn(mobile)}>Mobile</button>
        </div>
      </div>

      <div role="status" style={{ flex: '0 0 auto', padding: '8px 16px', background: '#fef3c7', borderBottom: '1px solid #fde68a', fontSize: '.75rem', color: '#92400e', textAlign: 'center' }}>
        This is a preview — anything you fill in here is not saved, and no one is notified.
      </div>

      {/* The mobile viewport is a width constraint on the real surface rather
          than a second rendering of it, so the two previews cannot diverge. */}
      <div data-preview-viewport={mobile ? 'mobile' : 'desktop'} style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', background: '#eceff4' }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: mobile ? MOBILE_WIDTH + 'px' : 'none', display: 'flex', flexDirection: 'column', minHeight: 0, borderLeft: mobile ? '1px solid #e3e7ee' : 'none', borderRight: mobile ? '1px solid #e3e7ee' : 'none' }}>
          {children}
        </div>
      </div>
    </section>
  );
}
