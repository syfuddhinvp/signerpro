/**
 * `/templates` — the index for the document-type guides.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Hero,
  Section,
  Container,
  SectionHeader,
  CtaBand,
  Cta,
  CtaRow,
  Chip,
} from '@/components/marketing';
import { TEMPLATE_GUIDES } from '@/lib/marketing/templates';

export const metadata: Metadata = {
  title: 'Document templates and how to build them',
  description:
    'How to set up the documents teams send most: who signs, in what order, and which field goes where. Written for the person building the template.',
  alternates: { canonical: '/templates' },
};

export default function Page() {
  return (
    <>
      <Hero
        eyebrow="Templates"
        title="Build it once, send it all year"
        lead="A guide for each document teams send most often: who signs it, the order they sign in, and every field it needs. Build it once as a template and the next one takes thirty seconds."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/product/templates" variant="on-dark" size="lg">
              How templates work
            </Cta>
          </CtaRow>
        }
      />

      <Section>
        <Container>
          <SectionHeader
            title="Pick a document"
            size="md"
            lead="Each guide lists the recipients, the routing order and the fields, so you can build the template while you read it."
          />
          <ul className="m-0 grid list-none grid-cols-1 gap-mk-grid p-0 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATE_GUIDES.map(guide => (
              <li key={guide.slug}>
                <Link
                  href={`/templates/${guide.slug}`}
                  className="flex h-full flex-col rounded-mk-card border border-mk-hairline bg-mk-card p-6 no-underline transition-colors hover:border-mk-action hover:no-underline"
                >
                  <h3 className="m-0 mb-2 text-mk-copy-lg font-bold text-mk-ink">{guide.name}</h3>
                  <p className="m-0 mb-4 text-mk-copy-sm text-mk-ink-muted">{guide.purpose}</p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Chip>{guide.signers.length} signers</Chip>
                    <Chip>{guide.fields.length} fields</Chip>
                    {guide.payment ? <Chip tone="sealed">Takes payment</Chip> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <CtaBand
        title="Build your first template today"
        lead="Upload the PDF you already use, place the fields once, and send it from then on without touching the layout again."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
