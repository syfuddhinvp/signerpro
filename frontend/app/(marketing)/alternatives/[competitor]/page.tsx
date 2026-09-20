/**
 * `/alternatives/<competitor>` — the round-up page.
 *
 * Different intent from `/vs/<competitor>`: somebody searching "alternatives"
 * has already decided to leave and wants a shortlist, not a head-to-head. So
 * this page lists the real field, including competitors we lose to, and places
 * SignerPro honestly inside it. A round-up where the author happens to rank
 * first and nobody else is described fairly is one nobody links to.
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
import { COMPETITORS, bySlug } from '@/lib/marketing/competitors';

/** The three we run a full round-up for. */
const ROUNDUPS = ['docusign', 'adobe-acrobat-sign', 'dropbox-sign'];

export function generateStaticParams() {
  return ROUNDUPS.map(competitor => ({ competitor }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ competitor: string }>;
}): Promise<Metadata> {
  const entry = bySlug((await params).competitor);
  if (!entry) return {};
  return {
    title: `${entry.name} alternatives, compared honestly`,
    description: `The real options if you are leaving ${entry.name}, what each one is good at, and what it costs. Figures checked ${entry.checkedOn}.`,
    alternates: { canonical: `/alternatives/${entry.slug}` },
  };
}

export default async function Page({ params }: { params: Promise<{ competitor: string }> }) {
  const slug = (await params).competitor;
  const entry = bySlug(slug);
  if (!entry || !ROUNDUPS.includes(slug)) notFound();

  const others = COMPETITORS.filter(candidate => candidate.slug !== entry.slug);

  return (
    <>
      <Hero
        eyebrow="Alternatives"
        title={`Leaving ${entry.name}?`}
        lead={`${entry.wedge} Here is the field, what each one is genuinely good at, and where we fit.`}
        note={`All figures read from each vendor's own pricing page on ${entry.checkedOn}.`}
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href={`/vs/${entry.slug}`} variant="on-dark" size="lg">
              SignerPro vs {entry.name}
            </Cta>
          </CtaRow>
        }
      />

      {/* We go first, and say plainly why — not because we rank ourselves top. */}
      <Section>
        <Container>
          <SectionHeader
            title="The options"
            size="md"
            lead="We have put ourselves first because this is our site. What each entry says about itself is the same information you would get from its own pricing page."
          />

          <ol className="m-0 flex list-none flex-col gap-mk-grid p-0">
            <Card as="li" featured>
              <div className="mb-2 flex flex-wrap items-center gap-2.5">
                <h3 className="m-0 text-mk-copy-lg font-bold text-mk-ink">SignerPro</h3>
                <Chip tone="action">This site</Chip>
              </div>
              <p className="m-0 mb-3 text-mk-copy-md text-mk-ink-muted">
                Best if you need the contract, the payment and the proof in one place. Unlimited
                sending, the API and single sign-on on every paid plan, payment taken during
                signing through your own Stripe account, and a link anyone can use to verify a
                finished document.
              </p>
              <p className="m-0 mb-3 text-mk-copy-sm text-mk-ink-subtle">
                Not the right pick if you need a long certification list, a thousand pre-built
                integrations, or proposal and quoting tools. We do not have those.
              </p>
              <Link
                href="/pricing"
                className="text-mk-copy-sm font-semibold text-mk-action-fg no-underline hover:underline"
              >
                See what it costs
              </Link>
            </Card>

            {others.map(other => (
              <Card as="li" key={other.slug}>
                <h3 className="m-0 mb-2 text-mk-copy-lg font-bold text-mk-ink">{other.name}</h3>
                <p className="m-0 mb-3 text-mk-copy-md text-mk-ink-muted">{other.stayIf}</p>
                <dl className="m-0 mb-3 grid gap-1 sm:grid-cols-2">
                  <div>
                    <dt className="m-0 text-mk-copy-xs uppercase tracking-wide text-mk-ink-subtle">
                      Entry price
                    </dt>
                    <dd className="m-0 text-mk-copy-sm text-mk-ink">{other.entryPrice}</dd>
                  </div>
                  <div>
                    <dt className="m-0 text-mk-copy-xs uppercase tracking-wide text-mk-ink-subtle">
                      Watch for
                    </dt>
                    <dd className="m-0 text-mk-copy-sm text-mk-ink">{other.cap}</dd>
                  </div>
                </dl>
                <Link
                  href={`/vs/${other.slug}`}
                  className="text-mk-copy-sm font-semibold text-mk-action-fg no-underline hover:underline"
                >
                  SignerPro vs {other.name}
                </Link>
              </Card>
            ))}
          </ol>
        </Container>
      </Section>

      <Section tone="alt">
        <Container width="prose">
          <SectionHeader
            title="How to pick"
            size="md"
            lead="Three questions that separate these products faster than any feature grid."
          />
          <ol className="m-0 flex list-none flex-col gap-4 p-0 text-left">
            {[
              {
                q: 'How many documents will you send in a year?',
                a: 'This is where the money is. Several of these plans include an allowance of about a hundred documents per user per year and bill for the rest, so a busy team can pay two or three times the advertised price.',
              },
              {
                q: 'Do you need to take money when someone signs?',
                a: 'Most of the field either does not offer it or puts it on the most expensive plan. If a deposit at signature matters to you, it narrows the list quickly.',
              },
              {
                q: 'Who has to believe the document later?',
                a: 'If a third party will ever need to check that a signed document is genuine, look for a public verification page and an audit certificate inside the PDF rather than a screenshot of a log.',
              },
            ].map(item => (
              <li key={item.q} className="rounded-mk-card border border-mk-hairline bg-mk-card p-5">
                <h3 className="m-0 mb-2 text-mk-copy-md font-bold text-mk-ink">{item.q}</h3>
                <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{item.a}</p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      <CtaBand
        title="Try the one you can test in an afternoon"
        lead="The free plan sends real documents. Put your own contract through it before you move a team."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
