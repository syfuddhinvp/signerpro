'use client';

import SegmentError from '@/app/_fallbacks/SegmentError';

/**
 * Error boundary for the whole `/platform/*` subtree.
 *
 * Without one, a failure here fell through to `app/(app)/error.tsx`, whose
 * recovery link is "Open documents" — a tenant route. A super admin whose
 * tenant list failed was offered a way out of their own workspace.
 */
export default function PlatformError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <SegmentError
      error={error}
      reset={reset}
      title="This platform view failed to load"
      body="The rest of the platform console is still working. Retry the view, or go back to the platform overview."
      homeHref="/platform"
      homeLabel="Platform overview"
    />
  );
}
