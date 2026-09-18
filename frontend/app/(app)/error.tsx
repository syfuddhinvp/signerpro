'use client';

import Link from 'next/link';
import { fallbackGhost, fallbackPage, fallbackPrimary } from '@/lib/sf/fallback';
import FallbackHero from '@/components/sf/parts/FallbackHero';
import Icon from '@/components/sf/Icon';

/**
 * In-app error boundary. It renders inside the Shell, so it fills the content
 * column rather than the viewport.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{ ...fallbackPage, minHeight: '60vh', background: 'transparent' }}>
      <FallbackHero
        title="This view failed to load"
        body="The rest of SignerPro is still working. Retry the view, or move on and come back to it."
        digest={error.digest}
        actions={
          <>
            <button type="button" onClick={reset} style={fallbackPrimary}><Icon name="refresh" size={14} />Retry</button>
            <Link href="/documents" style={fallbackGhost}>Open documents</Link>
          </>
        }
      />
    </div>
  );
}
