/**
 * Public marketing layout.
 *
 * Three jobs, and only three:
 *
 *  1. `data-surface="marketing"` — the switch that brings the marketing token
 *     scale in `app/marketing-tokens.css` into scope. Every `mk-` utility
 *     resolves against custom properties declared under this attribute, so a
 *     marketing component rendered outside this tree is deliberately unstyled
 *     rather than quietly importing a 5rem headline into the app.
 *  2. The shared header and footer, so a page is only its own content.
 *  3. A skip link, since the sticky header puts several links before the
 *     heading on every page.
 *
 * It adds no chrome of its own: marketing paints full-bleed bands, which is why
 * it stays out of the application Shell and the auth split-screen.
 */
import type { ReactNode } from 'react';
import Nav from '@/components/marketing/Nav';
import Footer from '@/components/marketing/Footer';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="marketing" className="bg-mk-canvas font-sans text-mk-ink">
      <a href="#main" className="sf-skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main">{children}</main>
      <Footer />
    </div>
  );
}
