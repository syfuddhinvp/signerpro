/**
 * The home page's hero image.
 *
 * A composed mock rather than a screenshot, for now: the capture script in
 * `scripts/marketing-screenshots.ts` needs a seeded environment to run
 * against, and a placeholder that holds the same box is better than a blank
 * space that reflows when the real image lands.
 *
 * What it shows is the argument the page is making — the sender's audit trail
 * and the signer's phone in one frame, with the payment line visible on both.
 * Nobody in the category shows the recipient's view at all, so it is the half
 * of the picture worth keeping when the real captures replace this.
 */
import { BrowserFrame, PhoneFrame } from './frames';

const LINES = ['92%', '78%', '85%'];

export default function HeroArt() {
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <BrowserFrame label="app.signerpro.com/documents">
        <div className="p-5">
          <p className="m-0 mb-4 text-mk-copy-sm font-bold text-mk-ink">
            Master services agreement
          </p>

          {LINES.map(width => (
            <span
              key={width}
              className="mb-2.5 block h-2 rounded-full bg-mk-canvas-sunken"
              style={{ width }}
            />
          ))}

          <p className="my-4 rounded-md border border-dashed border-mk-action bg-mk-action-subtle px-3 py-3 text-mk-copy-xs font-semibold text-mk-action-fg">
            Signature · Dana R.
          </p>

          <span className="mb-2.5 block h-2 w-3/5 rounded-full bg-mk-canvas-sunken" />

          <p className="mt-4 mb-0 flex items-center justify-between border-t border-mk-hairline pt-3.5 text-mk-copy-sm text-mk-ink-muted">
            <span>Deposit due at signing</span>
            <strong className="text-mk-copy-md text-mk-sealed-fg" data-sf-num>
              $1,500.00
            </strong>
          </p>
        </div>
      </BrowserFrame>

      {/* The signer's side, overlapping the corner on wide screens and sitting
          under the browser frame on narrow ones. */}
      <PhoneFrame
        className="mx-auto mt-[-2rem] sm:absolute sm:-bottom-10 sm:-right-4 sm:mt-0 sm:max-w-[200px]"
        label="The signer's view on a phone: the agreement, a signature field, and a $1,500 deposit paid at signing."
      >
        <div className="bg-mk-card p-3.5">
          <p className="m-0 mb-2.5 text-mk-copy-xs font-bold text-mk-ink">Sign and pay</p>
          <span className="mb-2 block h-1.5 w-full rounded-full bg-mk-canvas-sunken" />
          <span className="mb-3 block h-1.5 w-4/5 rounded-full bg-mk-canvas-sunken" />
          <p className="m-0 mb-2.5 rounded border border-dashed border-mk-action bg-mk-action-subtle px-2 py-3 text-center font-[var(--font-caveat)] text-mk-copy-sm text-mk-action-fg">
            Dana R.
          </p>
          <p className="m-0 flex min-h-[32px] items-center justify-center rounded-mk-chip bg-mk-sealed px-3 text-mk-copy-xs font-bold text-white">
            Pay $1,500 and finish
          </p>
        </div>
      </PhoneFrame>
    </div>
  );
}
