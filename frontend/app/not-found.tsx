import type { Metadata } from 'next';
import Link from 'next/link';
import { fallbackGhost, fallbackPage, fallbackPrimary } from '@/lib/sf/fallback';
import FallbackHero from '@/components/sf/parts/FallbackHero';

export const metadata: Metadata = { title: 'Page not found · SignerPro' };

export default function NotFound() {
  return (
    <main style={fallbackPage}>
      <FallbackHero
        tone="missing"
        title="That page isn't here"
        body="The link may be out of date, or the envelope it pointed to has been moved or deleted."
        actions={
          <>
            <Link href="/overview" style={fallbackPrimary}>Back to overview</Link>
            <Link href="/documents" style={fallbackGhost}>Open documents</Link>
          </>
        }
      />
    </main>
  );
}
