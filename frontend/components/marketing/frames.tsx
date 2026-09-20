/**
 * Device frames for product imagery.
 *
 * The plan's imagery rule is "real UI only", and the reason is in the research:
 * a fifth of SaaS sites never show the product, and the illustration-led pages
 * in this category are indistinguishable from one another. These frames wrap a
 * real screenshot so it reads as software rather than as a floating rectangle.
 *
 * Until `scripts/marketing-screenshots.ts` has been run against a seeded
 * environment, `src` may be absent and the frame renders its children instead,
 * which is how the hero's composed mock is drawn. Both paths keep the frame's
 * aspect ratio, so swapping a mock for a real capture cannot shift layout
 * (CLS).
 */
import type { ReactNode } from 'react';
import { cx } from './primitives';

/** A browser chrome frame for desktop captures. */
export function BrowserFrame({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** The URL shown in the fake address bar. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-mk-shot border border-mk-hairline bg-mk-card shadow-mk-shot',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-mk-hairline bg-mk-canvas-alt px-3 py-2">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="block h-2.5 w-2.5 rounded-full bg-mk-hairline-strong" />
          <span className="block h-2.5 w-2.5 rounded-full bg-mk-hairline-strong" />
          <span className="block h-2.5 w-2.5 rounded-full bg-mk-hairline-strong" />
        </span>
        {label ? (
          <span className="ml-2 truncate rounded-mk-chip bg-mk-canvas px-2.5 py-0.5 text-mk-copy-xs text-mk-ink-subtle">
            {label}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A phone frame. The recipient's signing flow is the product's least-marketed
 * surface across the whole category, and it happens on a phone, so it gets a
 * frame of its own rather than being cropped into the desktop shot.
 */
export function PhoneFrame({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cx(
        'w-full max-w-[280px] overflow-hidden rounded-[2rem] border-[6px] border-mk-band bg-mk-card shadow-mk-shot',
        className,
      )}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <div className="flex justify-center bg-mk-band py-1.5" aria-hidden="true">
        <span className="block h-1 w-14 rounded-full bg-mk-band-hairline/30" />
      </div>
      <div aria-hidden={label ? true : undefined}>{children}</div>
    </div>
  );
}
