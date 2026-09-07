import type { ReactNode } from 'react';
import {
  fallbackArt, fallbackCode, fallbackCopy, fallbackHeadline, fallbackHero,
  fallbackLead, fallbackMark, fallbackRow,
} from '@/lib/sf/fallback';
import FallbackArt from '@/components/sf/parts/FallbackArt';

/**
 * The shared body of every framework-level dead end (root error, segment
 * errors, not-found): a full-width hero with the copy on one side and a large
 * illustration on the other, rather than a small card in the middle of an
 * empty viewport.
 *
 * Styling is inline throughout because the root boundary can render when the
 * stylesheet itself failed to load.
 */
export default function FallbackHero({
  tone = 'error',
  title,
  body,
  digest,
  actions,
}: {
  tone?: 'error' | 'missing';
  title: string;
  body: ReactNode;
  /** Next.js error digest, the only handle support has on a specific failure. */
  digest?: string;
  actions: ReactNode;
}) {
  return (
    <div style={fallbackHero}>
      <div style={fallbackCopy}>
        <div style={fallbackMark}>SF</div>
        <h1 style={fallbackHeadline}>{title}</h1>
        <p style={fallbackLead}>{body}</p>
        {digest ? <p style={fallbackCode}>Reference {digest}</p> : null}
        <div style={fallbackRow}>{actions}</div>
      </div>
      <div style={fallbackArt}>
        <FallbackArt tone={tone} />
      </div>
    </div>
  );
}
