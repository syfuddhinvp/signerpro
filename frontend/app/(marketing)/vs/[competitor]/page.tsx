/**
 * `/vs/<competitor>` — one page per competitor, generated from
 * `lib/marketing/competitors.ts`.
 *
 * These pages are the highest-intent organic surface in the category: the
 * research found comparison pages credited with a material share of two
 * competitors' growth, and every mid-market vendor runs a set. What stops them
 * being worthless is the data file's two constraints — every figure carries the
 * date it was checked and a link to the page it came from, and every entry has
 * to concede at least one row. Both are printed on the page, not just held in
 * the source.
 *
 * Statically generated: the content is a module, so there is nothing to render
 * per request.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Hero,
  Section,
  Container,
  SectionHeader,
  CompareTable,
  CtaBand,
  Cta,
  CtaRow,
  Card,
  Chip,
} from '@/components/marketing';
import { COMPETITORS, bySlug } from '@/lib/marketing/competitors';

export function generateStaticParams() {
  return COMPETITORS.map(entry => ({ competitor: entry.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const entry = bySlug((await params).competitor);
  if (!entry) return {};
  return {
    title: `SignerPro vs ${entry.name} — an honest comparison`,
    description: `How SignerPro and ${entry.name} differ on price, sending limits, payments and proof. Figures checked ${entry.checkedOn}.`,
    alternates: { canonical: `/vs/${entry.slug}` },
  };
}

export default async function Page({ params }: { params: Promise<{ competitor: string }> }) {
  const entry = bySlug((await params).competitor);
  if (!entry) notFound();

  const concessions = entry.rows.filter(row => row.theirWin);

  return (
    <>
      <Hero
        eyebrow="Comparison"
        title={`SignerPro vs ${entry.name}`}
        lead={entry.wedge}
        note={`${entry.name} figures checked on ${entry.checkedOn}.`}
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/pricing" variant="on-dark" size="lg">
              See our pricing
            </Cta>
          </CtaRow>
        }
      />

      <Section tone="alt">
        <Container>
          <SectionHeader
            title={`What ${entry.name} costs`}
            lead="Their published price, and the limit that sits behind it."
            size="md"
          />
          <div className="mx-auto grid max-w-mk-container gap-mk-grid sm:grid-cols-2">
            <Card as="div">
              <h3 className="m-0 mb-2 text-mk-copy-sm font-bold uppercase tracking-wide text-mk-ink-subtle">
                Entry price
              </h3>
              <p className="m-0 text-mk-copy-lg text-mk-ink">{entry.entryPrice}</p>
            </Card>
            <Card as="div">
              <h3 className="m-0 mb-2 text-mk-copy-sm font-bold uppercase tracking-wide text-mk-ink-subtle">
                The limit behind it
              </h3>
              <p className="m-0 text-mk-copy-lg text-mk-ink">{entry.cap}</p>
            </Card>
          </div>
          <p className="mx-auto mt-mk-stack mb-0 max-w-mk-measure text-center text-mk-copy-xs text-mk-ink-subtle">
            Read from{' '}
            <a href={entry.source} rel="nofollow noopener" className="underline">
              {entry.name}&rsquo;s own pricing page
            </a>{' '}
            on {entry.checkedOn}. Prices change, and if this is out of date we want to know.
          </p>
        </Container>
      </Section>

      <CompareTable
        rows={entry.rows}
        competitor={entry.name}
        caption={`Feature by feature. Rows where ${entry.name} is the better choice are marked as such.`}
      />

      {/* The concession section. It is deliberately not buried at the bottom of
          a table: naming where the other product wins is what makes the rest of
          the page worth reading. */}
      <Section tone="alt">
        <Container width="prose">
          <SectionHeader
            title={`When to choose ${entry.name} instead`}
            size="md"
            lead={entry.stayIf}
          />
          <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
            {concessions.map(row => (
              <li key={row.feature}>
                <Chip>{row.feature}</Chip>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section>
        <Container width="prose">
          <SectionHeader
            title="Compare something else"
            size="md"
            lead="Every comparison we publish follows the same rule: dated figures, and at least one row where the other product wins."
          />
          <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
            {COMPETITORS.filter(other => other.slug !== entry.slug).map(other => (
              <li key={other.slug}>
                <Link
                  href={`/vs/${other.slug}`}
                  className="inline-flex min-h-mk-cta items-center rounded-mk-chip border border-mk-control-edge px-4 text-mk-copy-sm font-semibold text-mk-ink no-underline hover:border-mk-action hover:text-mk-action-fg hover:no-underline"
                >
                  vs {other.name}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <CtaBand
        title={`Try it against ${entry.name}`}
        lead="Send a real document on the free plan and see the difference on your own paperwork rather than on a comparison table."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
