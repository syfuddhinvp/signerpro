import Link from 'next/link';
import type { CSSProperties } from 'react';
import { SF_FONT } from '@/lib/sf/fallback';

/**
 * `not-found.tsx` body for the document-scoped segments. These render *inside*
 * the app shell, so this is the same in-content empty-state card the builder
 * and workflow screens already use for "no document" rather than a full-page
 * fallback.
 */
const card: CSSProperties = {
  maxWidth: '420px', background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '16px',
  padding: '22px', display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center',
};
const titleStyle: CSSProperties = { fontSize: '.84375rem', fontWeight: 600, color: 'hsl(var(--color-fg-default))' };
const bodyStyle: CSSProperties = { fontSize: '.75rem', lineHeight: 1.6, color: 'hsl(var(--color-fg-muted))' };
const linkStyle: CSSProperties = {
  height: '32px', padding: '0 13px', borderRadius: '9px', border: '1px solid hsl(var(--color-accent-solid))',
  background: 'hsl(var(--color-accent-solid))', color: 'hsl(var(--color-fg-on-solid))', fontSize: '.78125rem', fontWeight: 600,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
};

export default function DocumentMissing({ title, body }: { title: string; body: string }) {
  return (
    <section style={{ padding: '22px', display: 'grid', placeItems: 'center', fontFamily: SF_FONT }}>
      <div style={card}>
        <span style={titleStyle}>{title}</span>
        <span style={bodyStyle}>{body}</span>
        <Link href="/documents" style={linkStyle}>Go to documents</Link>
      </div>
    </section>
  );
}
