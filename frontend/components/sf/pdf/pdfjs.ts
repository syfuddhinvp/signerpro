'use client';

/**
 * pdf.js, loaded lazily and configured once.
 *
 * Why `pdfjs-dist` directly rather than `react-pdf`: react-pdf@9 pins its own
 * copy of `pdfjs-dist` (4.8.69) while this app resolves 4.10.38, and pdf.js
 * refuses to run when the API and the worker are different builds
 * ("The API version does not match the Worker version"). Talking to pdf.js
 * directly means one copy, one worker, and no wrapper CSS to import — and the
 * overlay geometry this app needs (points, top-left origin, see
 * `lib/sf/adapters.ts`) is *exactly* what `getViewport({ scale: 1 })` reports,
 * so the wrapper would only have hidden it.
 *
 * The import is dynamic so pdf.js (~350 kB gzipped, plus its worker) lands in
 * its own async chunk and is fetched only on the two routes that draw a
 * document. `next.config.ts` keeps the worker out of the server bundle.
 */

import type * as PdfjsModule from 'pdfjs-dist';

export type Pdfjs = typeof PdfjsModule;

let pending: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  if (pending) return pending;
  pending = import('pdfjs-dist').then(pdfjs => {
    // Webpack/Turbopack rewrite `new URL(..., import.meta.url)` into an emitted
    // asset URL, so the worker is served from this app's own origin — no CDN,
    // and no version skew with the API copy above.
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pending;
}
