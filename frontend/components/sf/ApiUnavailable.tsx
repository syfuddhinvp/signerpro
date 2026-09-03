'use client';

/**
 * The "we could not reach the API" affordance.
 *
 * The audit's headline failure was that a backend outage rendered as a
 * confident, healthy-looking empty state — "0 documents · $0 MRR · 100%
 * uptime" — which is indistinguishable from a new workspace. The transport
 * already reports an outage correctly (`ApiError` with `kind: 'network'`); the
 * missing half was screen-side. Any surface that substitutes an empty/zero
 * value for a failed call must render this instead of, or alongside, the
 * substituted data, so the reader knows the numbers are not measurements.
 *
 * `role="alert"` so it is announced, and a real retry so the reader has
 * somewhere to go.
 */

import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { TEXT_SUBTLE } from '@/lib/sf/ui';

const bannerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
  padding: '11px 13px', borderRadius: '11px', border: '1px solid #fecaca',
  background: '#fef2f2', color: '#7f1d1d', fontSize: '.78125rem', lineHeight: 1.5,
};

const retryStyle: CSSProperties = {
  height: '30px', padding: '0 12px', borderRadius: '9px', border: '1px solid #fca5a5',
  background: '#fff', color: '#7f1d1d', fontSize: '.75rem', fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto',
};

export type ApiUnavailableProps = {
  /** What could not be loaded, e.g. "the log stream". */
  what: string;
  /** The `ApiError.message` when there is one. */
  detail?: string | null;
  /** Called by the Retry button. Defaults to re-running the server render. */
  onRetry?: () => void;
};

export default function ApiUnavailable({ what, detail, onRetry }: ApiUnavailableProps) {
  const router = useRouter();
  return (
    <div role="alert" style={bannerStyle}>
      <span>
        <strong>Can&rsquo;t reach the SignForge API.</strong>{' '}
        {what} could not be loaded, so anything shown below is stale or blank — not a measurement.
        {detail ? <span style={{ color: TEXT_SUBTLE }}> ({detail})</span> : null}
      </span>
      <button type="button" style={retryStyle} onClick={() => (onRetry ? onRetry() : router.refresh())}>
        Retry
      </button>
    </div>
  );
}
