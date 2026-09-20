/**
 * `/solutions/<vertical>` — one page per line of work.
 *
 * Same pattern as `/templates/<type>`: the workflows named here are the ones
 * that vertical actually runs, each one naming the feature that handles it
 * (`FEATURES.md` section noted beside the copy in `lib/marketing/verticals.ts`).
 * Related document guides are cross-linked where `lib/marketing/templates.ts`
 * has a matching `vertical`; the section is skipped where it does not.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Hero,
  Section,
  Container,
  SectionHeader,
  CtaBand,
  Cta,
  CtaRow,
  Card,
  Faq,
} from '@/components/marketing';
import { VERTICALS, verticalBySlug, guidesFor } from '@/lib/marketing/verticals';

export function generateStaticParams() {
  return VERTICALS.map(vertical => ({ vertical: vertical.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vertical: string }>;
}): Promise<Metadata> {
  const vertical = verticalBySlug((await params).vertical);
  if (!vertical) return {};
  return {
    title: `${vertical.name} e-signature and payments`,
    description: vertical.problem,
    alternates: { canonical: `/solutions/${vertical.slug}` },
  };
}

export default async function Page({ params }: { params: Promise<{ vertical: string }> }) {
  const vertical = verticalBySlug((await params).vertical);
  if (!vertical) notFound();

  const guides = guidesFor(vertical.slug);
  const others = VERTICALS.filter(other => other.slug !== vertical.slug);

  return (
    <>
      <Hero
        eyebrow="Solutions"
        title={vertical.headline}
        lead={vertical.problem}
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
        note="No card to start. Every paid plan includes payments, the API and your own branding."
      />

      <Section>
        <Container>
          <SectionHeader
            eyebrow={vertical.name}
            title="Where the paperwork actually drags"
            size="md"
            lead="Each workflow below names the step that slows it down today and how SignerPro closes it."
          />
          <ul className="m-0 grid list-none grid-cols-1 gap-mk-grid p-0 sm:grid-cols-2">
            {vertical.workflows.map(workflow => (
              <Card as="li" key={workflow.name}>
                <h3 className="m-0 mb-2 text-mk-copy-lg font-bold text-mk-ink">{workflow.name}</h3>
                <p className="m-0 mb-3 text-mk-copy-sm font-semibold text-mk-ink-muted">
                  {workflow.who}
                </p>
                <p className="m-0 mb-3 text-mk-copy-sm text-mk-ink-subtle">{workflow.drag}</p>
                <p className="m-0 text-mk-copy-sm text-mk-ink">{workflow.handled}</p>
              </Card>
            ))}
          </ul>
        </Container>
      </Section>

      {guides.length ? (
        <Section tone="alt">
          <Container width="prose">
            <SectionHeader title="Related document guides" size="md" />
            <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
              {guides.map(guide => (
                <li key={guide.slug}>
                  <Link
                    href={`/templates/${guide.slug}`}
                    className="inline-flex min-h-mk-cta items-center rounded-mk-chip border border-mk-control-edge px-4 text-mk-copy-sm font-semibold text-mk-ink no-underline hover:border-mk-action hover:text-mk-action-fg hover:no-underline"
                  >
                    {guide.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </Section>
      ) : null}

      <Section>
        <Container width="prose">
          <Faq items={vertical.faq} />
        </Container>
      </Section>

      <Section tone="alt">
        <Container>
          <SectionHeader title="Other lines of work we cover" size="md" />
          <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
            {others.map(other => (
              <li key={other.slug}>
                <Link
                  href={`/solutions/${other.slug}`}
                  className="inline-flex min-h-mk-cta items-center rounded-mk-chip border border-mk-control-edge px-4 text-mk-copy-sm font-semibold text-mk-ink no-underline hover:border-mk-action hover:text-mk-action-fg hover:no-underline"
                >
                  {other.name}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <CtaBand
        title={`Send your first ${vertical.name.toLowerCase()} document this week`}
        lead="Upload the PDF you already use, place the fields, and send it. The free plan covers your first documents."
        secondary={{ href: '/solutions', label: 'All solutions' }}
      />
    </>
  );
}
