'use client';

/**
 * The real document, drawn.
 *
 * Both authoring surfaces (`Builder`) and the signing surface (`Signer`) put
 * their field overlay on top of this. Before it existed each of them painted a
 * hardcoded block of contract prose, so senders placed fields on content that
 * was not their document and signers attested to paper they had never been
 * shown — audit finding C2.
 *
 * GEOMETRY CONTRACT (the frontend half of the seam in `lib/sf/adapters.ts`):
 * every page reports its true size in PDF points, from the page's own viewport.
 * `scale` is CSS pixels per point. An overlay positions a field with
 *
 *     left: field.x * scale        width:  field.width  * scale
 *     top:  field.y * scale        height: field.height * scale
 *
 * and is correct at every zoom level and on every page size — Letter, A4,
 * Legal, landscape, or a mix of them in one file — because nothing here assumes
 * a page size.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from './pdfjs';
import Icon from '@/components/sf/Icon';

/** One page's true size, and the scale it is being drawn at. */
export type PdfGeometry = {
  page: number;
  /** True page size in PDF points, from the page's own viewport. */
  widthPt: number;
  heightPt: number;
  /** CSS pixels per point. */
  scale: number;
  /** Rendered box, in CSS pixels. */
  widthPx: number;
  heightPx: number;
};

type DocState =
  | { status: 'loading' }
  | { status: 'password'; retry: boolean }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: PDFDocumentProxy; sizes: { widthPt: number; heightPt: number }[] };

/**
 * Loads a PDF and measures every page. Password-protected files surface as a
 * real prompt rather than a blank sheet; so does a 404/403/502 from the
 * passthrough route.
 */
export function usePdfDocument(fileUrl: string | null) {
  const [state, setState] = useState<DocState>({ status: 'loading' });
  const supply = useRef<((password: string) => void) | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!fileUrl) { setState({ status: 'error', message: 'No document to display.' }); return; }
    let cancelled = false;
    let doc: PDFDocumentProxy | null = null;
    setState({ status: 'loading' });

    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const task = pdfjs.getDocument({ url: fileUrl, withCredentials: true });
        let asked = false;
        task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          supply.current = updatePassword;
          if (cancelled) return;
          // reason 2 (INCORRECT_PASSWORD) means the last attempt was wrong.
          setState({ status: 'password', retry: reason === 2 || asked });
          asked = true;
        };
        doc = await task.promise;
        if (cancelled) { void doc.destroy(); return; }
        const sizes: { widthPt: number; heightPt: number }[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          sizes.push({ widthPt: viewport.width, heightPt: viewport.height });
        }
        if (cancelled) { void doc.destroy(); return; }
        setState({ status: 'ready', doc, sizes });
      } catch (error) {
        if (cancelled) return;
        const name = (error as { name?: string })?.name;
        const message = name === 'MissingPDFException'
          ? 'This document could not be found on the server.'
          : name === 'InvalidPDFException'
            ? 'This file is not a readable PDF.'
            : 'The document could not be loaded.';
        setState({ status: 'error', message });
      }
    })();

    return () => { cancelled = true; if (doc) void doc.destroy(); };
    // `attempt` re-runs the load after the viewer supplies a password.
  }, [fileUrl, attempt]);

  const submitPassword = useCallback((password: string) => {
    if (supply.current) { supply.current(password); setState({ status: 'loading' }); return; }
    setAttempt(n => n + 1);
  }, []);

  const retry = useCallback(() => setAttempt(n => n + 1), []);

  return { state, submitPassword, retry };
}

/* ── one page's canvas ──────────────────────────────────────────────────── */

function PageCanvas({ doc, page, scale, widthPx, heightPx }: {
  doc: PDFDocumentProxy; page: number; scale: number; widthPx: number; heightPx: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // A whole document is mounted at once so it scrolls as one column; only the
  // pages near the viewport are actually rasterised, so a 200-page file costs
  // no more to draw than a short one.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(
      entries => { if (entries.some(entry => entry.isIntersecting)) setVisible(true); },
      { rootMargin: '800px 0px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      const canvas = ref.current;
      if (!canvas) return;
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      // Draw at device resolution so the page stays sharp when zoomed in and on
      // high-DPI phones; the CSS box stays exactly `widthPx × heightPx` so the
      // overlay's arithmetic is unaffected.
      const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 3);
      const viewport = pdfPage.getViewport({ scale: scale * dpr });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) return;
      const render = pdfPage.render({ canvasContext: context, viewport });
      task = render;
      try { await render.promise; } catch { /* superseded by a re-render */ }
    })();
    return () => { cancelled = true; if (task) task.cancel(); };
  }, [doc, page, scale, visible]);

  return (
    <canvas
      ref={ref}
      aria-label={`Page ${page} of the document`}
      style={{ display: 'block', width: widthPx + 'px', height: heightPx + 'px' }}
    />
  );
}

/* ── states ────────────────────────────────────────────────────────────── */

const cardStyle: CSSProperties = {
  background: '#fff', border: '1px solid #e3e7ee', borderRadius: '14px', padding: '22px 20px',
  display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '460px', margin: '0 auto',
};

export function PdfMessage({ tone, title, body, action }: {
  tone: 'info' | 'error'; title: string; body: string; action?: ReactNode;
}) {
  return (
    <div role="status" style={cardStyle}>
      <span style={{ fontSize: '.6875rem', letterSpacing: '.12em', fontWeight: 700, color: tone === 'error' ? '#b91c1c' : '#64748b' }}>
        {tone === 'error' ? 'DOCUMENT UNAVAILABLE' : 'DOCUMENT'}
      </span>
      <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px', color: '#0f172a' }}>{title}</span>
      <span style={{ fontSize: '.78125rem', lineHeight: 1.6, color: '#475569' }}>{body}</span>
      {action}
    </div>
  );
}

function PasswordPrompt({ retry, onSubmit }: { retry: boolean; onSubmit: (password: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      style={cardStyle}
      onSubmit={(e) => { e.preventDefault(); if (value) onSubmit(value); }}
    >
      <span style={{ fontSize: '.6875rem', letterSpacing: '.12em', fontWeight: 700, color: '#64748b' }}>PASSWORD REQUIRED</span>
      <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.2px', color: '#0f172a' }}>This PDF is password-protected</span>
      <span style={{ fontSize: '.78125rem', lineHeight: 1.6, color: '#475569' }}>
        {retry
          ? 'That password did not open the file. Check it with the sender and try again.'
          : 'Enter the password the sender gave you to open the document.'}
      </span>
      <input
        type="password"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        aria-label="Document password"
        placeholder="Document password"
        style={{ height: '36px', border: '1px solid #e3e7ee', borderRadius: '9px', padding: '0 11px', fontSize: '.8125rem', color: '#0f172a' }}
      />
      <button
        type="submit"
        style={{ height: '36px', borderRadius: '9px', border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff', fontSize: '.8125rem', fontWeight: 600, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '7px' }}
      >
        <Icon name="documents" size={14} />Open document
      </button>
    </form>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" style={{ ...cardStyle, alignItems: 'center', textAlign: 'center' }}>
      <span style={{ fontSize: '.78125rem', color: '#64748b' }}>{label}</span>
    </div>
  );
}

/* ── the viewer ────────────────────────────────────────────────────────── */

export type PdfPagesProps = {
  /** A same-origin URL that streams the PDF (`/api/proxy/...` or `/sign/{token}/pdf`). */
  fileUrl: string | null;
  /** Page numbers to draw, in order. Pages the file does not have are skipped. */
  pages: number[];
  /**
   * CSS pixels per point. Omit to fit each page to `containerWidth` (what the
   * signing surface does — this is what makes it work on a 390 px phone).
   */
  scale?: number;
  /** Width available for one page, in CSS px, when `scale` is not given. */
  containerWidth?: number;
  /** Never draw a page wider than this many CSS px when fitting. */
  maxWidth?: number;
  /** Overlay drawn inside each page box, positioned by the caller from `scale`. */
  renderOverlay?: (geometry: PdfGeometry) => ReactNode;
  /** Extra props (ref, pointer handlers) for the page box itself. */
  pageBoxProps?: (geometry: PdfGeometry) => Record<string, unknown>;
  /** Told the geometry of every page as soon as it is known. */
  onGeometry?: (sizes: { widthPt: number; heightPt: number }[]) => void;
  gap?: number;
};

export default function PdfPages({
  fileUrl, pages, scale, containerWidth, maxWidth = 1000, renderOverlay, pageBoxProps, onGeometry, gap = 20,
}: PdfPagesProps) {
  const { state, submitPassword, retry } = usePdfDocument(fileUrl);

  const sizes = state.status === 'ready' ? state.sizes : null;
  useEffect(() => { if (sizes && onGeometry) onGeometry(sizes); }, [sizes, onGeometry]);

  if (state.status === 'loading') return <Skeleton label="Loading the document…" />;
  if (state.status === 'password') return <PasswordPrompt retry={state.retry} onSubmit={submitPassword} />;
  if (state.status === 'error') {
    return (
      <PdfMessage
        tone="error"
        title="The document could not be displayed"
        body={state.message + ' Nothing has been signed, and no field you have filled in is lost.'}
        action={
          <button
            type="button"
            onClick={retry}
            style={{ alignSelf: 'flex-start', height: '32px', padding: '0 14px', borderRadius: '9px', border: '1px solid #e3e7ee', background: '#fff', fontSize: '.78125rem', cursor: 'pointer', color: '#0f172a',
              display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Icon name="refresh" size={13} />Try again
          </button>
        }
      />
    );
  }

  const { doc, sizes: pageSizes } = state;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: gap + 'px' }}>
      {pages.filter(n => n >= 1 && n <= pageSizes.length).map(n => {
        const size = pageSizes[n - 1];
        const fitted = scale ?? Math.min(maxWidth, Math.max(240, containerWidth ?? maxWidth)) / size.widthPt;
        const geometry: PdfGeometry = {
          page: n,
          widthPt: size.widthPt,
          heightPt: size.heightPt,
          scale: fitted,
          widthPx: size.widthPt * fitted,
          heightPx: size.heightPt * fitted,
        };
        const extra = pageBoxProps ? pageBoxProps(geometry) : {};
        return (
          <div
            key={n}
            data-pdf-page={n}
            {...extra}
            style={{
              position: 'relative',
              width: geometry.widthPx + 'px',
              height: geometry.heightPx + 'px',
              flex: '0 0 auto',
              background: '#fff',
              borderRadius: '3px',
              boxShadow: '0 24px 60px -24px rgba(15,23,42,.35), 0 0 0 1px #dfe4ec',
              // Only the authoring surface swallows touch gestures (it drags
              // fields). The signing surface must stay scrollable on a phone.
              touchAction: pageBoxProps ? 'none' : 'auto',
              ...(extra.style as CSSProperties | undefined),
            }}
          >
            <PageCanvas doc={doc} page={n} scale={fitted} widthPx={geometry.widthPx} heightPx={geometry.heightPx} />
            {renderOverlay ? renderOverlay(geometry) : null}
          </div>
        );
      })}
    </div>
  );
}
