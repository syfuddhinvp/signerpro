/**
 * The marketing site's header.
 *
 * Sticky, because the research's strongest placement finding is that the
 * navbar CTA out-converts every other position. It is a `<details>`-based
 * disclosure on small screens rather than a client component: the marketing
 * site's budget is 150KB of JavaScript per page and a menu toggle is not worth
 * any of it.
 *
 * WCAG 2.2's 2.4.11 (focus not obscured) is why the sticky header carries
 * `scroll-margin` on the sections it links to — a focused heading must not end
 * up underneath it.
 */
import Link from 'next/link';
import BrandMark from '@/components/sf/BrandMark';
import { Cta } from './Cta';
import { MARKETING_NAV, BRAND_ACCENT } from '@/lib/marketing/nav';

export default function Nav() {
  return (
    <header className="sticky top-0 z-sticky-header border-b border-mk-hairline bg-mk-canvas/90 backdrop-blur">
      <div className="mx-auto flex max-w-mk-wide items-center gap-6 px-mk-gutter py-3">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 text-mk-copy-md font-bold text-mk-ink no-underline hover:text-mk-ink hover:no-underline"
        >
          <BrandMark size={28} accent={BRAND_ACCENT} />
          <span>SignerPro</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-6 lg:flex">
          {MARKETING_NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="text-mk-copy-sm font-medium text-mk-ink-muted no-underline hover:text-mk-ink hover:no-underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Cta href="/login" variant="ghost" className="hidden sm:inline-flex">
            Sign in
          </Cta>
          <Cta href="/register">Start free</Cta>
        </div>
      </div>

      {/* Small-screen menu. `<details>` gives a keyboard-operable disclosure
          with no script; the summary is a 44px target. */}
      <details className="border-t border-mk-hairline lg:hidden">
        <summary className="flex min-h-mk-cta cursor-pointer list-none items-center px-mk-gutter text-mk-copy-sm font-semibold text-mk-ink-muted">
          Menu
        </summary>
        <nav aria-label="Main, small screens" className="flex flex-col gap-1 px-mk-gutter pb-4">
          {MARKETING_NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-mk-cta items-center text-mk-copy-sm font-medium text-mk-ink-muted no-underline hover:text-mk-ink hover:no-underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </details>
    </header>
  );
}
