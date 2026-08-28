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
  maxWidth: '420px', background: '#fff', border: '1px solid #e3e7ee', borderRadius: '16px',
  padding: '22px', display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'center',
};
const titleStyle: CSSProperties = { fontSize: '13.5px', fontWeight: 600, color: '#0f172a' };
const bodyStyle: CSSProperties = { fontSize: '12px', lineHeight: 1.6, color: '#64748b' };
const linkStyle: CSSProperties = {
  height: '32px', padding: '0 13px', borderRadius: '9px', border: '1px solid #4f46e5',
  background: '#4f46e5', color: '#fff', fontSize: '12.5px', fontWeight: 600,
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
