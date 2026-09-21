'use client';

/**
 * `PdfPages` behind `next/dynamic({ ssr: false })`.
 *
 * pdf.js is browser-only (it reaches for `DOMMatrix`, `Path2D` and a Worker),
 * and it is by far the heaviest thing this app ships. Importing it this way
 * keeps it out of the server bundle *and* out of every route that does not draw
 * a document: the builder and the signing surface pull it as an async chunk on
 * mount, and nothing else in the app links to it.
 */

import dynamic from 'next/dynamic';
import type { PdfPagesProps } from './PdfPages';

const PdfPages = dynamic(() => import('./PdfPages'), {
  ssr: false,
  loading: () => (
    <div role="status" aria-live="polite" style={{ padding: '22px', fontSize: '.78125rem', color: 'hsl(var(--color-fg-muted))', textAlign: 'center' }}>
      Loading the document…
    </div>
  ),
});

export type { PdfGeometry, PdfPagesProps } from './PdfPages';

export default function LazyPdfPages(props: PdfPagesProps) {
  return <PdfPages {...props} />;
}
