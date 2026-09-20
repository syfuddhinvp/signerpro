/**
 * `/templates/<type>` — one guide per document type.
 *
 * The page answers the question somebody actually has when they land here:
 * how do I set this document up. Recipients in routing order, a field table
 * with who fills each one, and the mistakes that cost a round trip.
 *
 * It does not offer a download, because the shared catalogue is only readable
 * by a signed-in sender (`backend/app/api/routes/catalog.py`). Claiming a free
 * template here and delivering a signup wall is the pattern that makes these
 * pages worthless, so the call to action says what actually happens.
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
  Chip,
} from '@/components/marketing';
import { TEMPLATE_GUIDES, templateBySlug } from '@/lib/marketing/templates';

export function generateStaticParams() {
  return TEMPLATE_GUIDES.map(guide => ({ type: guide.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string }>;
}): Promise<Metadata> {
  const guide = templateBySlug((await params).type);
  if (!guide) return {};
  return {
    title: `${guide.name} — signers, routing and fields`,
    description: `How to set up a ${guide.name.toLowerCase()} for electronic signature: who signs, in what order, and every field it needs.`,
    alternates: { canonical: `/templates/${guide.slug}` },
  };
}

export default async function Page({ params }: { params: Promise<{ type: string }> }) {
  const guide = templateBySlug((await params).type);
  if (!guide) notFound();

  const related = TEMPLATE_GUIDES.filter(
    other => other.slug !== guide.slug && other.vertical === guide.vertical,
  ).slice(0, 3);

  return (
    <>
      <Hero
        eyebrow="Template guide"
        title={guide.name}
        lead={guide.purpose}
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Build this free
            </Cta>
            <Cta href="/templates" variant="on-dark" size="lg">
              All templates
            </Cta>
          </CtaRow>
        }
        note="Start free, upload your own PDF, and place these fields on it. No card needed."
      />

      <Section>
        <Container>
          <SectionHeader title="Who signs it" size="md" lead="In the order they should receive it." />
          <ol className="m-0 grid list-none grid-cols-1 gap-mk-grid p-0 sm:grid-cols-3">
            {guide.signers.map((signer, index) => (
              <Card as="li" key={signer.role}>
                <span
                  aria-hidden="true"
                  className="mb-3 grid h-8 w-8 place-items-center rounded-full bg-mk-action text-mk-copy-sm font-bold text-mk-action-ink"
                >
                  {index + 1}
                </span>
                <h3 className="m-0 mb-2 text-mk-copy-md font-bold text-mk-ink">{signer.role}</h3>
                <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{signer.does}</p>
              </Card>
            ))}
          </ol>
        </Container>
      </Section>

      <Section tone="alt">
        <Container>
          <SectionHeader
            title="The fields it needs"
            size="md"
            lead="Assign every field to the recipient who has to fill it in. A field with no owner is the most common reason a document comes back unfinished."
          />
          <div className="overflow-x-auto rounded-mk-card border border-mk-hairline">
            <table className="w-full border-collapse bg-mk-card text-left">
              <thead>
                <tr className="border-b border-mk-hairline bg-mk-canvas-alt">
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    Field
                  </th>
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    Who fills it
                  </th>
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    Required
                  </th>
                </tr>
              </thead>
              <tbody>
                {guide.fields.map(field => (
                  <tr key={field.field} className="border-b border-mk-hairline last:border-b-0">
                    <th
                      scope="row"
                      className="px-5 py-3 align-top text-mk-copy-sm font-semibold text-mk-ink"
                    >
                      {field.field}
                      {field.note ? (
                        <span className="mt-1 block font-normal text-mk-copy-xs text-mk-ink-subtle">
                          {field.note}
                        </span>
                      ) : null}
                    </th>
                    <td className="px-5 py-3 align-top text-mk-copy-sm text-mk-ink-muted">
                      {field.assignedTo}
                    </td>
                    <td className="px-5 py-3 align-top text-mk-copy-sm">
                      {field.required ? (
                        <span className="font-semibold text-mk-ink">Yes</span>
                      ) : (
                        <span className="text-mk-ink-subtle">Optional</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      {guide.payment ? (
        <Section>
          <Container width="prose">
            <SectionHeader eyebrow="Payment" title="Take the money at the signature" size="md" />
            <p className="m-0 text-center text-mk-copy-lg text-mk-ink-muted">{guide.payment}</p>
            <p className="mt-mk-stack mb-0 text-center">
              <Link
                href="/product/payments"
                className="text-mk-copy-md font-semibold text-mk-action-fg no-underline hover:underline"
              >
                How payments work
              </Link>
            </p>
          </Container>
        </Section>
      ) : null}

      <Section tone="alt">
        <Container width="prose">
          <SectionHeader title="What to get right" size="md" />
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {guide.watchFor.map(point => (
              <li
                key={point}
                className="flex gap-3 rounded-mk-card border border-mk-hairline bg-mk-card p-5 text-mk-copy-md text-mk-ink"
              >
                <span
                  aria-hidden="true"
                  className="mt-[.5em] block h-1.5 w-1.5 flex-none rounded-full bg-mk-sealed"
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {related.length ? (
        <Section>
          <Container width="prose">
            <SectionHeader title="Related documents" size="md" />
            <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
              {related.map(other => (
                <li key={other.slug}>
                  <Link
                    href={`/templates/${other.slug}`}
                    className="inline-flex min-h-mk-cta items-center rounded-mk-chip border border-mk-control-edge px-4 text-mk-copy-sm font-semibold text-mk-ink no-underline hover:border-mk-action hover:text-mk-action-fg hover:no-underline"
                  >
                    {other.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-mk-stack mb-0 text-center">
              <Chip>Import standard forms from your workspace&rsquo;s shared catalogue</Chip>
            </p>
          </Container>
        </Section>
      ) : null}

      <CtaBand
        title={`Send a ${guide.name.toLowerCase()} this afternoon`}
        lead="Upload your PDF, place these fields, and send it. The free plan covers your first documents."
        label="Build this free"
        secondary={{ href: '/templates', label: 'All templates' }}
      />
    </>
  );
}
