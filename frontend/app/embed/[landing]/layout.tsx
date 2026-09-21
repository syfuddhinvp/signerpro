/**
 * Chrome for the framed surface.
 *
 * Deliberately minimal: this page renders *inside a customer's own
 * application*, so it carries no navigation, no workspace switcher and no
 * account menu — the host owns all of that. What is left is a single
 * provenance strip, because a signature surface embedded in someone else's UI
 * still has to say whose surface it is.
 *
 * Framing itself is not decided here. `middleware.ts` emits a per-session
 * `Content-Security-Policy: frame-ancestors` built from the embed session's
 * tenant allowlist; this layout renders identically whether the browser
 * allowed the framing or refused it.
 */

import type { Metadata } from 'next';
import { SF_FONT } from '@/lib/sf/fallback';

export const metadata: Metadata = { title: 'Embedded session · SignerPro', robots: { index: false, follow: false } };

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'hsl(var(--color-bg-canvas))', fontFamily: SF_FONT, color: 'hsl(var(--color-fg-default))' }}>
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</main>
    </div>
  );
}
