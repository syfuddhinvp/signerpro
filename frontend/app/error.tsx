'use client';

import Link from 'next/link';
import { fallbackGhost, fallbackPage, fallbackPrimary } from '@/lib/sf/fallback';
import FallbackHero from '@/components/sf/parts/FallbackHero';

/** Root error boundary — the layout itself may have failed, so keep this self-contained. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={fallbackPage}>
      <FallbackHero
        title="Something went wrong"
        body="SignerPro couldn't finish loading this page. Nothing you signed or sent has been lost."
        digest={error.digest}
        actions={
          <>
            <button type="button" onClick={reset} style={fallbackPrimary}>Try again</button>
            <Link href="/overview" style={fallbackGhost}>Back to overview</Link>
          </>
        }
      />
    </main>
  );
}
