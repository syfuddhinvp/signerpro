/**
 * The plan grid.
 *
 * Renders whatever `GET /api/billing/plans` returns — the same rows the in-app
 * plan picker shows. Two rules carried over from the page this replaces and
 * worth restating, because they are what stop a pricing section from lying:
 *
 *  1. No price is typed here. If the API is unreachable the section does not
 *     render at all, rather than falling back to a figure that was true when
 *     somebody last edited the file.
 *  2. The heading is derived from the catalogue's own shape (`lib/marketing/
 *     pricing.ts`), so it cannot contradict the cards underneath it.
 *
 * The middle paid tier is highlighted. That is the anchoring pattern every
 * reference pricing page uses, and it is computed rather than hard-coded to
 * index 1 so inserting a tier does not silently promote the wrong one.
 */
import type { PlanChoice } from '@/lib/sf/adapters';
import { Container, SectionHeader, Chip, cx } from './primitives';
import { Cta } from './Cta';

export default function PricingCards({
  plans,
  featured,
  title,
  lead,
  id = 'pricing',
  footnote,
}: {
  plans: PlanChoice[];
  /** Index into `plans`; -1 to highlight nothing. */
  featured: number;
  title: string;
  lead: string;
  id?: string;
  footnote?: string;
}) {
  if (!plans.length) return null;

  return (
    <section id={id} className="scroll-mt-24 bg-mk-canvas px-mk-gutter py-mk-section">
      <Container>
        <SectionHeader title={title} lead={lead} size="md" />

        <ul className="m-0 grid list-none grid-cols-1 gap-mk-grid p-0 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan, index) => {
            const isFeatured = index === featured;
            return (
              <li
                key={plan.code}
                className={cx(
                  'flex flex-col rounded-mk-card border p-6',
                  isFeatured
                    ? 'border-mk-action bg-mk-card shadow-mk-card'
                    : 'border-mk-hairline bg-mk-card',
                )}
              >
                <div className="mb-2.5 flex items-center gap-2.5">
                  <h3 className="m-0 text-mk-copy-lg font-bold text-mk-ink">{plan.name}</h3>
                  {plan.tag ? <Chip tone="action">{plan.tag}</Chip> : null}
                </div>

                <p className="m-0 mb-5 font-display font-bold text-mk-display-sm text-mk-ink" data-sf-num>
                  {plan.priceLabel}
                  <span className="text-mk-copy-sm font-sans font-semibold text-mk-ink-muted">
                    {' '}
                    / mo
                  </span>
                </p>

                <ul className="m-0 mb-6 flex list-none flex-col gap-2.5 p-0">
                  {plan.lines.map(line => (
                    <li
                      key={line.k}
                      className="flex justify-between gap-4 border-b border-mk-hairline pb-2.5 text-mk-copy-sm text-mk-ink-muted"
                    >
                      <span>{line.k}</span>
                      <strong className="text-right text-mk-ink">{line.v}</strong>
                    </li>
                  ))}
                </ul>

                <Cta
                  href={`/register?plan=${encodeURIComponent(plan.code)}`}
                  variant={isFeatured ? 'solid' : 'outline'}
                  block
                  className="mt-auto"
                >
                  Choose {plan.name}
                </Cta>
              </li>
            );
          })}
        </ul>

        {footnote ? (
          <p className="mx-auto mt-mk-stack-lg mb-0 max-w-mk-measure text-center text-mk-copy-sm text-mk-ink-muted">
            {footnote}
          </p>
        ) : null}
      </Container>
    </section>
  );
}
