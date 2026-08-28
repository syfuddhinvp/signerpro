'use client';

/**
 * Last-resort boundary for the public signing route. A recipient must never see
 * a stack trace, so this mirrors the designed token states: what happened, that
 * nothing is lost, and one way forward.
 */
import {
  fallbackBody, fallbackCard, fallbackCode, fallbackMark, fallbackPage,
  fallbackPrimary, fallbackRow, fallbackTitle,
} from '@/lib/sf/fallback';

export default function SignError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={fallbackPage}>
      <div style={fallbackCard}>
        <div style={fallbackMark}>SF</div>
        <h1 style={fallbackTitle}>This signing session could not be opened</h1>
        <p style={fallbackBody}>
          Something went wrong loading your envelope. Nothing you have already signed has been lost — every
          completed field is stored the moment you leave it.
        </p>
        {error.digest ? <p style={fallbackCode}>Reference {error.digest}</p> : null}
        <div style={fallbackRow}>
          <button type="button" onClick={reset} style={fallbackPrimary}>Try again</button>
        </div>
      </div>
    </main>
  );
}
