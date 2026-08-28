'use client';

import Link from 'next/link';
import {
  fallbackBody, fallbackCard, fallbackCode, fallbackGhost, fallbackMark,
  fallbackPage, fallbackPrimary, fallbackRow, fallbackTitle,
} from '@/lib/sf/fallback';

/**
 * In-app error boundary. It renders inside the Shell, so it fills the content
 * column rather than the viewport.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ ...fallbackPage, minHeight: '60vh', background: 'transparent' }}>
      <div style={fallbackCard}>
        <div style={fallbackMark}>SF</div>
        <h1 style={fallbackTitle}>This view failed to load</h1>
        <p style={fallbackBody}>
          The rest of SignForge is still working. Retry the view, or move on and come back to it.
        </p>
        {error.digest ? <p style={fallbackCode}>Reference {error.digest}</p> : null}
        <div style={fallbackRow}>
          <button type="button" onClick={reset} style={fallbackPrimary}>Retry</button>
          <Link href="/documents" style={fallbackGhost}>Open documents</Link>
        </div>
      </div>
    </div>
  );
}
