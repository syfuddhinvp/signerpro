/**
 * The hero band.
 *
 * Structure follows the formula the research settles on: an eyebrow that says
 * the category, a headline that is fully descriptive on its own, a subheading
 * that explains *how* so the headline is believable, one primary action with
 * one secondary, and a reassurance line under them. Anything else competes
 * with the action.
 *
 * The art sits in the second grid column on desktop and *above* the copy on
 * small screens, which is the one place the source order and the visual order
 * differ. That is deliberate: on a phone the product image is what stops the
 * scroll, while a screen reader and the tab order still get the headline
 * first.
 */
import type { ReactNode } from 'react';
import { Container, Eyebrow, Display } from './primitives';

export default function Hero({
  eyebrow,
  title,
  lead,
  actions,
  note,
  art,
  artFirstOnMobile = true,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  actions: ReactNode;
  /** The line under the buttons: what it costs, what is required. */
  note?: ReactNode;
  art?: ReactNode;
  artFirstOnMobile?: boolean;
}) {
  return (
    <section
      data-sf-dark=""
      className="relative overflow-hidden bg-mk-band bg-mk-glow px-mk-gutter py-mk-band text-mk-band-ink"
    >
      <Container width="wide">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_.95fr]">
          <div className={artFirstOnMobile ? 'order-2 lg:order-1' : undefined}>
            {eyebrow ? <Eyebrow onDark>{eyebrow}</Eyebrow> : null}
            <Display level={1} size="xl" className="text-mk-band-ink">
              {title}
            </Display>
            <p className="mt-mk-stack mb-mk-stack-lg max-w-[52ch] text-mk-copy-xl text-mk-band-ink-muted">
              {lead}
            </p>
            {actions}
            {note ? (
              <p className="mt-5 mb-0 text-mk-copy-sm text-mk-band-ink-muted">{note}</p>
            ) : null}
          </div>

          {art ? (
            <div className={artFirstOnMobile ? 'order-1 lg:order-2' : undefined}>{art}</div>
          ) : null}
        </div>
      </Container>
    </section>
  );
}
