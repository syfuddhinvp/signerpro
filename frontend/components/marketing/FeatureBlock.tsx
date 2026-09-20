/**
 * An alternating feature row: heading, paragraph, bullet list, product image.
 *
 * Each one answers a single objection rather than describing a feature, which
 * is the difference between "Payments" and "they sign, they pay, done". The
 * `reverse` flag alternates the image side down the page so a run of them does
 * not read as a list.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Container, Display, cx } from './primitives';

export default function FeatureBlock({
  eyebrow,
  title,
  body,
  points,
  art,
  link,
  reverse = false,
  tone = 'canvas',
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  body: ReactNode;
  points?: string[];
  art: ReactNode;
  link?: { href: string; label: string };
  reverse?: boolean;
  tone?: 'canvas' | 'alt';
}) {
  return (
    <section
      className={cx(
        'px-mk-gutter py-mk-section',
        tone === 'alt' ? 'border-y border-mk-hairline bg-mk-canvas-alt' : 'bg-mk-canvas',
      )}
    >
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className={reverse ? 'lg:order-2' : undefined}>
            {eyebrow ? (
              <p className="m-0 mb-3 text-mk-eyebrow uppercase text-mk-action-fg">{eyebrow}</p>
            ) : null}
            <Display level={2} size="md">
              {title}
            </Display>
            <p className="mt-mk-stack mb-0 max-w-mk-measure text-mk-copy-lg text-mk-ink-muted">
              {body}
            </p>

            {points?.length ? (
              <ul className="m-0 mt-mk-stack flex list-none flex-col gap-2.5 p-0">
                {points.map(point => (
                  <li key={point} className="flex gap-3 text-mk-copy-md text-mk-ink">
                    <span
                      aria-hidden="true"
                      className="mt-[.45em] block h-1.5 w-1.5 flex-none rounded-full bg-mk-sealed"
                    />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {link ? (
              <p className="m-0 mt-mk-stack">
                <Link
                  href={link.href}
                  className="text-mk-copy-md font-semibold text-mk-action-fg no-underline hover:underline"
                >
                  {link.label}
                </Link>
              </p>
            ) : null}
          </div>

          <div className={reverse ? 'lg:order-1' : undefined}>{art}</div>
        </div>
      </Container>
    </section>
  );
}
