import type { Metadata } from 'next';
import Link from 'next/link';
import {
  fallbackBody, fallbackCard, fallbackGhost, fallbackMark, fallbackPage,
  fallbackPrimary, fallbackRow, fallbackTitle,
} from '@/lib/sf/fallback';

export const metadata: Metadata = { title: 'Page not found · SignForge' };

export default function NotFound() {
  return (
    <main style={fallbackPage}>
      <div style={fallbackCard}>
        <div style={fallbackMark}>SF</div>
        <h1 style={fallbackTitle}>That page isn&rsquo;t here</h1>
        <p style={fallbackBody}>
          The link may be out of date, or the envelope it pointed to has been moved or deleted.
        </p>
        <div style={fallbackRow}>
          <Link href="/overview" style={fallbackPrimary}>Back to overview</Link>
          <Link href="/documents" style={fallbackGhost}>Open documents</Link>
        </div>
      </div>
    </main>
  );
}
