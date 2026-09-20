/**
 * The FAQ section, with its structured data.
 *
 * Two jobs. On the page it answers the questions that stop a signup, which the
 * research says are the ones competitors dodge: what counts as an envelope,
 * what happens when you cancel, whether signers pay, where the data lives. In
 * the head it emits `FAQPage` JSON-LD so those answers can surface directly in
 * search results.
 *
 * The JSON-LD is generated from the same array the page renders, so the two can
 * never disagree — a mismatch between visible content and structured data is
 * treated as spam.
 */
import { Container, SectionHeader } from './primitives';

export type FaqItem = { q: string; a: string };

export default function Faq({
  items,
  title = 'Questions people ask first',
  lead,
  id = 'faq',
  /** Set false on a page that already emits another FAQPage block. */
  schema = true,
}: {
  items: FaqItem[];
  title?: string;
  lead?: string;
  id?: string;
  schema?: boolean;
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };

  return (
    <section
      id={id}
      className="scroll-mt-24 border-y border-mk-hairline bg-mk-canvas-alt px-mk-gutter py-mk-section"
    >
      <Container width="prose">
        <SectionHeader title={title} lead={lead} size="md" />
        <div className="flex flex-col gap-3">
          {items.map(item => (
            <details
              key={item.q}
              className="rounded-mk-card border border-mk-hairline bg-mk-card px-5 py-4"
            >
              <summary className="cursor-pointer text-mk-copy-md font-semibold text-mk-ink">
                {item.q}
              </summary>
              <p className="mt-3 mb-0 text-mk-copy-sm text-mk-ink-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>

      {schema ? (
        <script
          type="application/ld+json"
          // The payload is built from the literal array above, never from user
          // input, so there is nothing here for a document to break out of.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
    </section>
  );
}
