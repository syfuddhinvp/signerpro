'use client';

/**
 * Last-resort boundary for the public signing route. A recipient must never see
 * a stack trace, so this mirrors the designed token states: what happened, that
 * nothing is lost, and one way forward.
 */
import { fallbackPage, fallbackPrimary } from '@/lib/sf/fallback';
import FallbackHero from '@/components/sf/parts/FallbackHero';

export default function SignError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={fallbackPage}>
      <FallbackHero
        title="This signing session could not be opened"
        body="Something went wrong loading your envelope. Nothing you have already signed has been lost — every completed field is stored the moment you leave it."
        digest={error.digest}
        actions={<button type="button" onClick={reset} style={fallbackPrimary}>Try again</button>}
      />
    </main>
  );
}
