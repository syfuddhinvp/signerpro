'use client';

import Link from 'next/link';
import {
  fallbackBody, fallbackCard, fallbackCode, fallbackGhost, fallbackMark,
  fallbackPage, fallbackPrimary, fallbackRow, fallbackTitle,
} from '@/lib/sf/fallback';

/** Root error boundary — the layout itself may have failed, so keep this self-contained. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={fallbackPage}>
      <div style={fallbackCard}>
        <div style={fallbackMark}>SF</div>
        <h1 style={fallbackTitle}>Something went wrong</h1>
        <p style={fallbackBody}>
          SignForge couldn&rsquo;t finish loading this page. Nothing you signed or sent has been lost.
        </p>
        {error.digest ? <p style={fallbackCode}>Reference {error.digest}</p> : null}
        <div style={fallbackRow}>
          <button type="button" onClick={reset} style={fallbackPrimary}>Try again</button>
          <Link href="/overview" style={fallbackGhost}>Back to overview</Link>
        </div>
      </div>
    </main>
  );
}
