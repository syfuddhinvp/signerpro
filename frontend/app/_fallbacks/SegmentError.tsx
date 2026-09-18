'use client';

import Link from 'next/link';
import { fallbackGhost, fallbackPage, fallbackPrimary } from '@/lib/sf/fallback';
import FallbackHero from '@/components/sf/parts/FallbackHero';
import Icon from '@/components/sf/Icon';

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
    <div style={{ ...fallbackPage, minHeight: '60vh', background: 'transparent' }} role="alert">
      <FallbackHero
        title={title}
        body={body}
        digest={error.digest}
        actions={
          <>
            <button type="button" onClick={reset} style={fallbackPrimary}><Icon name="refresh" size={14} />Retry</button>
            <Link href={homeHref} style={fallbackGhost}>{homeLabel}</Link>
          </>
        }
      />
    </div>
  );
}
