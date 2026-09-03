'use client';

import Link from 'next/link';
import {
  fallbackBody, fallbackCard, fallbackCode, fallbackGhost, fallbackMark,
  fallbackPage, fallbackPrimary, fallbackRow, fallbackTitle,
} from '@/lib/sf/fallback';

/**
 * Body of a segment `error.tsx`.
 *
 * The recovery links have to belong to the workspace the user is actually in:
 * the `(app)` boundary offers "Open documents", which is a tenant route and
 * a dead end for a platform admin whose `/platform/*` view just failed.
 */
export default function SegmentError({
  error,
  reset,
  title,
  body,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  body: string;
  homeHref: string;
  homeLabel: string;
}) {
  return (
    <div style={{ ...fallbackPage, minHeight: '60vh', background: 'transparent' }}>
      <div style={fallbackCard} role="alert">
        <div style={fallbackMark}>SF</div>
        <h1 style={fallbackTitle}>{title}</h1>
        <p style={fallbackBody}>{body}</p>
        {error.digest ? <p style={fallbackCode}>Reference {error.digest}</p> : null}
        <div style={fallbackRow}>
          <button type="button" onClick={reset} style={fallbackPrimary}>Retry</button>
          <Link href={homeHref} style={fallbackGhost}>{homeLabel}</Link>
        </div>
      </div>
    </div>
  );
}
