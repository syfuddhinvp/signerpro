/**
 * The public marketing page — rendered at `/` for a visitor with no session,
 * and always at `/product` so a signed-in user can still link to it.
 *
 * Rebuilt on `components/marketing/`. What used to be 200 lines of CSS inside a
 * template string is now the shared kit, and the layout, rhythm and colour come
 * from the marketing token layer — so the seven pages that follow this one
 * inherit the same decisions instead of re-deriving them.
 *
 * The two rules that governed the original page still govern this one:
 *
 *  1. Every claim is something the product actually does. The copy lives in
 *     `lib/marketing/content.ts` with the FEATURES.md section beside each block.
 *  2. Pricing is never retyped. The catalogue is served by
 *     `GET /api/billing/plans`; if the call fails the section is omitted rather
 *     than invented. The heading is derived from the catalogue's own shape, so
 *     it cannot claim "per seat" over a grid of flat per-workspace plans — which
 *     is exactly what it used to do.
 *
 * It remains a server component: no client state, no client JavaScript.
 */
import {
  Hero,
  ProofStrip,
  FeatureBlock,
  StepList,
  PricingCards,
  Faq,
  CtaBand,
  Cta,
  CtaRow,
  BrowserFrame,
  PaymentsMock,
  RoutingMock,
  AuditMock,
  ApiMock,
} from '@/components/marketing';
import HeroArt from '@/components/marketing/HeroArt';
import { apiFetchPublic } from '@/lib/api/client';
import { toPlanChoices, type PlanChoice } from '@/lib/sf/adapters';
import type { PlanResponse } from '@/lib/api/types';
import { pricingCopy, featuredIndex, type PricingCopy } from '@/lib/marketing/pricing';
import { HERO, BLOCKS, STEPS, FAQ } from '@/lib/marketing/content';

/** The mock shown beside each objection block, in the order `BLOCKS` lists them. */
const BLOCK_ART = [PaymentsMock, RoutingMock, AuditMock, ApiMock];
const BLOCK_URL = [
  'app.signerpro.com/payments',
  'app.signerpro.com/documents/workflow',
  'app.signerpro.com/documents/audit',
  'app.signerpro.com/developer/api',
];

/** `GET /api/billing/plans` is public; a failure hides the grid, never fakes it. */
async function loadPlans(): Promise<{ choices: PlanChoice[]; copy: PricingCopy | null }> {
  const res = await apiFetchPublic<PlanResponse[]>('/api/billing/plans');
  if (!res.ok) return { choices: [], copy: null };
  return { choices: toPlanChoices(res.data), copy: pricingCopy(res.data) };
}

export default async function MarketingPage() {
  const { choices, copy } = await loadPlans();

  return (
    <>
      <Hero
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        lead={HERO.lead}
        note={HERO.note}
        art={<HeroArt />}
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/product/signing" variant="on-dark" size="lg">
              See the signer&rsquo;s view
            </Cta>
          </CtaRow>
        }
      />

      {/* Proof stays empty until there is something true to put in it. The
          component renders nothing rather than a placeholder logo wall;
          MARKETING_PLAN.md section 7 is the track that fills it. */}
      <ProofStrip />

      {BLOCKS.map((block, index) => {
        /* One mock per block, in block order: payments, routing, proof, API.
           `BLOCK_ART` lives here rather than in `content.ts` because the copy
           module is prose that a non-engineer should be able to edit. */
        const Art = BLOCK_ART[index];
        return (
          <FeatureBlock
            key={block.title}
            eyebrow={block.eyebrow}
            title={block.title}
            body={block.body}
            points={block.points}
            link={block.link}
            reverse={index % 2 === 1}
            tone={index % 2 === 1 ? 'alt' : 'canvas'}
            art={
              <BrowserFrame label={BLOCK_URL[index]}>
                <Art />
              </BrowserFrame>
            }
          />
        );
      })}

      <StepList
        id="how"
        title="Four steps, start to sealed"
        lead="The first document takes about five minutes. The second one takes thirty seconds."
        steps={STEPS}
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

      <Faq items={FAQ} />

      <CtaBand
        title="Send your first document today"
        lead="Create a workspace, upload a PDF, and have it signed — and paid for — before the end of the afternoon."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
