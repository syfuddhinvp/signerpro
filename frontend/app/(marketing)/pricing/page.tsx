/**
 * The pricing page.
 *
 * Loads the catalogue exactly the way `MarketingPage` does, because that is
 * the one rule this page cannot break twice: no price is ever typed here.
 * `PricingCards` renders the cards from `GET /api/billing/plans`; if that
 * call fails the page still renders — the comparison matrix and the FAQ do
 * not depend on the API, only the cards do.
 *
 * FAQ answers the four questions MARKETING_PLAN.md section 3 says every
 * competitor dodges, plus three more that come up before a signup.
 */
import type { Metadata } from 'next';
import { Hero, PricingCards, PlanMatrix, Faq, CtaBand, Cta, CtaRow } from '@/components/marketing';
import { apiFetchPublic } from '@/lib/api/client';
import { toPlanChoices, type PlanChoice } from '@/lib/sf/adapters';
import type { PlanResponse } from '@/lib/api/types';
import { pricingCopy, featuredIndex, type PricingCopy } from '@/lib/marketing/pricing';
import { MATRIX_PLANS, MATRIX } from '@/lib/marketing/pricing-matrix';

export const metadata: Metadata = {
  title: 'Pricing — SignerPro',
  description:
    'See what every plan includes, with no price typed by hand: the cards below come straight from the plan catalogue.',
};

async function loadPlans(): Promise<{ choices: PlanChoice[]; copy: PricingCopy | null }> {
  const res = await apiFetchPublic<PlanResponse[]>('/api/billing/plans');
  if (!res.ok) return { choices: [], copy: null };
  return { choices: toPlanChoices(res.data), copy: pricingCopy(res.data) };
}

const FAQ = [
  {
    // MARKETING_PLAN.md §3 — "what counts as an envelope".
    q: 'What counts as a document?',
    a: 'One document is one file sent for signature, no matter how many people sign it or how many fields it has. Editing a document you already sent and resending it does not count twice.',
  },
  {
    q: 'What happens when I cancel?',
    a: 'Your workspace keeps working until the end of the period you already paid for, then drops to whatever the free plan allows. Documents you already sent stay sealed and downloadable either way.',
  },
  {
    q: 'Do the people who sign pay anything?',
    a: 'No. Signing is always free for the person receiving a link. The only money that moves from a signer is a payment you set up yourself, and it goes to your own Stripe account, not to us.',
  },
  {
    q: 'Where is my data stored?',
    a: 'In the region your workspace is provisioned in. Sealed documents, audit trails and account data all stay there, and an export is available from your account settings at any time.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes, from the billing page. Moving up applies right away; moving down or cancelling takes effect at the end of the current period, and you can see the effect on your bill before you confirm it.',
  },
  {
    q: 'Is there a free trial on paid plans?',
    a: 'You do not need one. The free plan has no card required, and you can send real documents on it before deciding whether to upgrade.',
  },
  {
    q: 'What happens if I go over my plan?',
    a: 'You will see the limit on your billing page before it becomes a problem. We do not silently block a document mid-send.',
  },
];

export default async function PricingPage() {
  const { choices, copy } = await loadPlans();

  return (
    <>
      <Hero
        eyebrow="Pricing"
        title="One catalogue, no hidden tier"
        lead="Every plan below is the same catalogue the app uses to sell itself. If a feature is not in the table, it is not on any plan."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/developers" variant="on-dark" size="lg">
              Read the API docs
            </Cta>
          </CtaRow>
        }
      />

      {copy && choices.length > 0 ? (
        <PricingCards
          plans={choices}
          featured={featuredIndex(choices)}
          title={copy.title}
          lead={copy.lead}
          footnote="Every paid plan includes the API, webhooks, embedded signing, single sign-on and your own branding."
        />
      ) : null}

      <PlanMatrix
        planNames={MATRIX_PLANS}
        categories={MATRIX}
        title="What is in every plan"
        lead="A document is one file sent for signature. Every field, every signer and every view inside it are part of that one document, not a separate charge."
      />

      <Faq items={FAQ} title="The questions people ask before they pay" />

      <CtaBand
        title="Start on the free plan"
        lead="No card, no trial clock. Send a real document today and upgrade only when you need to."
        secondary={{ href: '/developers', label: 'See the API' }}
      />
    </>
  );
}
