/**
 * The proof row directly under the hero.
 *
 * Deliberately small. The research is blunt about over-badging: a hero carrying
 * seven trust marks measured *worse* than one carrying three, and the badge
 * wall belongs on the trust centre instead. So this takes at most three claims
 * and a logo row, and every claim has to be something the platform can
 * actually count.
 *
 * `metrics` is passed in by the page, which reads it from the API. When the
 * numbers are not available the strip renders the logos alone rather than
 * printing a zero or inventing a figure — the same rule the pricing section
 * has always followed.
 */
import type { ReactNode } from 'react';
import { Container } from './primitives';

export type ProofMetric = { value: string; label: string };

export default function ProofStrip({
  metrics = [],
  logos = [],
  caption,
}: {
  metrics?: ProofMetric[];
  logos?: string[];
  caption?: ReactNode;
}) {
  if (!metrics.length && !logos.length) return null;

  return (
    <section
      aria-label="Proof"
      className="border-b border-mk-hairline bg-mk-canvas px-mk-gutter py-10"
    >
      <Container>
        {metrics.length ? (
          <dl className="m-0 flex flex-wrap justify-center gap-x-12 gap-y-6 text-center">
            {metrics.slice(0, 3).map(metric => (
              <div key={metric.label}>
                <dt className="sr-only">{metric.label}</dt>
                <dd className="m-0">
                  <span
                    data-sf-num
                    className="block font-display font-bold text-mk-display-sm text-mk-ink"
                  >
                    {metric.value}
                  </span>
                  <span className="mt-1 block text-mk-copy-sm text-mk-ink-muted">
                    {metric.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {logos.length ? (
          <>
            {caption ? (
              <p className="mx-auto mb-5 mt-mk-stack-lg max-w-mk-measure text-center text-mk-copy-sm text-mk-ink-subtle">
                {caption}
              </p>
            ) : null}
            <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-x-10 gap-y-4 p-0">
              {logos.map(name => (
                <li
                  key={name}
                  className="text-mk-copy-md font-semibold tracking-tight text-mk-ink-subtle"
                >
                  {name}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Container>
    </section>
  );
}
