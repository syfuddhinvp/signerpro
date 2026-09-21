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
import Icon from '@/components/sf/Icon';

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
    background: on ? 'hsl(var(--color-bg-surface))' : 'transparent', color: on ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))',
    boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
  });

  const chip = (on: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 10px', borderRadius: '99px',
    border: '1px solid ' + (on ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))'), background: on ? 'hsl(var(--color-accent-subtle))' : 'hsl(var(--color-bg-surface))',
    color: on ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-subtle))', fontSize: '.75rem', fontWeight: on ? 600 : 500,
    textDecoration: 'none', whiteSpace: 'nowrap',
  });

  return (
    <section data-screen-label="Signer preview" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 16px', background: 'hsl(var(--color-bg-surface))', borderBottom: '1px solid hsl(var(--color-border-subtle))' }}>
        <Link href={backHref} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '.78125rem', fontWeight: 600, color: 'hsl(var(--color-fg-subtle))', textDecoration: 'none' }}>
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

        <div role="group" aria-label="Preview viewport" style={{ marginLeft: 'auto', display: 'flex', gap: '4px', background: 'hsl(var(--color-bg-muted))', padding: '4px', borderRadius: '10px' }}>
          <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)} style={viewportBtn(!mobile)}><Icon name="desktop" size={12} />Desktop</button>
          <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)} style={viewportBtn(mobile)}><Icon name="mobile" size={12} />Mobile</button>
        </div>
      </div>

      <div role="status" style={{ flex: '0 0 auto', padding: '8px 16px', background: 'hsl(var(--color-bg-warning-subtle))', borderBottom: '1px solid hsl(var(--color-border-warning))', fontSize: '.75rem', color: 'hsl(var(--color-fg-warning))', textAlign: 'center' }}>
        This is a preview — anything you fill in here is not saved, and no one is notified.
      </div>

      {/* The mobile viewport is a width constraint on the real surface rather
          than a second rendering of it, so the two previews cannot diverge. */}
      <div data-preview-viewport={mobile ? 'mobile' : 'desktop'} style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', background: 'hsl(var(--color-bg-muted))' }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: mobile ? MOBILE_WIDTH + 'px' : 'none', display: 'flex', flexDirection: 'column', minHeight: 0, borderLeft: mobile ? '1px solid hsl(var(--color-border-subtle))' : 'none', borderRight: mobile ? '1px solid hsl(var(--color-border-subtle))' : 'none' }}>
          {children}
        </div>
      </div>
    </section>
  );
}
