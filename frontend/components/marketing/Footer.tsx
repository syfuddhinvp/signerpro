/**
 * The marketing footer.
 *
 * It carries the whole site map rather than four convenience links, because
 * the acquisition pages — comparisons, templates, solutions — need an internal
 * link from every page to be discovered and to accumulate any authority. This
 * is the single mechanism that turns a set of generated pages into an indexed
 * set of pages.
 */
import Link from 'next/link';
import BrandMark from '@/components/sf/BrandMark';
import { FOOTER_COLUMNS, BRAND_ACCENT } from '@/lib/marketing/nav';

export default function Footer() {
  return (
    <footer className="border-t border-mk-hairline bg-mk-canvas-alt px-mk-gutter py-mk-section text-mk-ink">
      <div className="mx-auto max-w-mk-wide">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-mk-copy-md font-bold text-mk-ink no-underline hover:text-mk-ink hover:no-underline"
            >
              <BrandMark size={26} accent={BRAND_ACCENT} />
              <span>SignerPro</span>
            </Link>
            <p className="mt-3 mb-0 max-w-[30ch] text-mk-copy-sm text-mk-ink-muted">
              The contract, the payment and the proof, in one link.
            </p>
          </div>

          {FOOTER_COLUMNS.map(column => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="m-0 mb-3 text-mk-copy-sm font-bold text-mk-ink">{column.title}</h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {column.links.map(link => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-mk-copy-sm text-mk-ink-muted no-underline hover:text-mk-ink hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-mk-stack-lg flex flex-wrap items-center gap-4 border-t border-mk-hairline pt-6">
          <p className="m-0 text-mk-copy-xs text-mk-ink-subtle">
            © {new Date().getFullYear()} SignerPro
          </p>
          <nav aria-label="Legal" className="ml-auto flex flex-wrap gap-5">
            <Link href="/legal/terms" className="text-mk-copy-xs text-mk-ink-subtle no-underline hover:underline">
              Terms
            </Link>
            <Link href="/legal/privacy" className="text-mk-copy-xs text-mk-ink-subtle no-underline hover:underline">
              Privacy
            </Link>
            <Link href="/legal/dpa" className="text-mk-copy-xs text-mk-ink-subtle no-underline hover:underline">
              Data processing
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
