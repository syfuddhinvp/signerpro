/**
 * `/solutions` — the index for the vertical pages.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Hero, Section, Container, SectionHeader, CtaBand, Cta, CtaRow } from '@/components/marketing';
import { VERTICALS } from '@/lib/marketing/verticals';

export const metadata: Metadata = {
  title: 'Solutions by line of work',
  description:
    'How SignerPro fits real estate, mortgage, property management, professional services, HR and legal, with the specific workflow each one runs.',
  alternates: { canonical: '/solutions' },
};

export default function Page() {
  return (
    <>
      <Hero
        eyebrow="Solutions"
        title="Built around how your paperwork actually moves"
        lead="Every line of work signs documents differently. Pick yours to see the workflows, the documents, and where payment fits."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/pricing" variant="on-dark" size="lg">
              See pricing
            </Cta>
          </CtaRow>
        }
      />

      <Section>
        <Container>
          <SectionHeader
            title="Pick your line of work"
            size="md"
            lead="Each page names the workflow that drags today and how SignerPro handles it."
          />
          <ul className="m-0 grid list-none grid-cols-1 gap-mk-grid p-0 sm:grid-cols-2 lg:grid-cols-3">
            {VERTICALS.map(vertical => (
              <li key={vertical.slug}>
                <Link
                  href={`/solutions/${vertical.slug}`}
                  className="flex h-full flex-col rounded-mk-card border border-mk-hairline bg-mk-card p-6 no-underline transition-colors hover:border-mk-action hover:no-underline"
                >
                  <h3 className="m-0 mb-2 text-mk-copy-lg font-bold text-mk-ink">{vertical.name}</h3>
                  <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{vertical.headline}</p>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <CtaBand
        title="Not sure which fits your team?"
        lead="Start free and set up your own document. Every plan covers the same routing, payments and audit trail regardless of vertical."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
