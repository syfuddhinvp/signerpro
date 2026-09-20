/**
 * Payments product page — the flagship differentiator.
 *
 * Every claim maps to FEATURES.md §7 (Stripe Connect onboarding, PaymentRequest
 * split modes, SignerPayment lifecycle, refunds, multi-currency).
 */
import type { Metadata } from 'next';
import {
  Hero,
  FeatureBlock,
  Faq,
  CtaBand,
  Cta,
  CtaRow,
  BrowserFrame,
  AuditMock,
  PaymentsMock,
  PrepareMock,
  RoutingMock,
} from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Payments in the signing session — SignerPro',
  description:
    'Connect your own Stripe account and collect payment inside the document your customer signs. Split it, refund it, and take it in the currency they use.',
};

const BLOCKS = [
  {
    // FEATURES.md §7 — Stripe Connect onboarding per tenant.
    eyebrow: 'Your account, your money',
    title: 'The money goes to your Stripe account, not ours.',
    body:
      'Connect Stripe once, from an onboarding flow built for this. If you leave partway through, the link picks up where you stopped instead of starting you over.',
    points: [
      'Stripe Connect onboarding with a resumable account link',
      'Funds settle straight to your own Stripe balance',
      'Your SignerPro subscription is billed separately from what signers pay you',
    ],
  },
  {
    // FEATURES.md §7 — PaymentRequest split modes.
    eyebrow: 'Split it your way',
    title: 'One fee, or a fee shared across the room.',
    body:
      'Attach a payment request to a document and choose how it is divided: one signer pays it all, it is split evenly, or you set a custom amount per recipient.',
    points: [
      'Single mode: one recipient owes the full amount',
      'Equal mode: the amount is divided across every paying signer',
      'Custom mode: you set a different amount per recipient',
    ],
  },
  {
    // FEATURES.md §7 — SignerPayment lifecycle, refunds, currencies.
    eyebrow: 'Track every payment',
    title: 'Watch the payment the same place you watch the signature.',
    body:
      'Each signer payment mirrors a Stripe PaymentIntent, so you always know if it is waiting, processing, paid or failed. If a refund is needed, issue it from the same view.',
    points: [
      'Live status: requires payment, processing, succeeded, failed, refunded',
      'Refund a signer without leaving the payments view',
      'Charge in the currency your customer expects, not just your own',
    ],
    link: { href: '/product/signing', label: 'See what the signer sees' },
  },
];

const FAQ = [
  {
    q: 'Do you ever hold the money?',
    a: 'No. Payments move from the signer to your connected Stripe account. SignerPro never sits between you and the funds.',
  },
  {
    q: 'Can I split a fee between more than one signer?',
    a: 'Yes. A payment request can be set to single, equal or custom split mode, so you can charge one signer, divide the amount evenly, or set a specific amount per person.',
  },
  {
    q: 'What happens if a signer needs a refund?',
    a: 'Issue it from the payments view on the document. The signer payment record updates to refunded so the status stays accurate for anyone who checks later.',
  },
  {
    q: 'Can I charge in a currency other than my own?',
    a: 'Yes, the payment service supports multiple currencies, so you can request an amount in the currency your customer actually uses.',
  },
  {
    q: 'Do I need a Stripe account already?',
    a: 'No. Onboarding walks you through connecting one, and if you stop partway through, coming back picks up exactly where you left off.',
  },
];

/** Product mocks stand in until real captures exist; see
 *  `components/marketing/mocks.tsx` and `scripts/marketing-screenshots.mjs`. */
const BLOCK_ART = [PrepareMock, RoutingMock, AuditMock];

export default function PaymentsPage() {
  return (
    <>
      <Hero
        eyebrow="Payments"
        title="Get paid at the signature, not after it."
        lead="Attach a payment request to any document. Your customer signs and pays in the same session, and the money lands in your own Stripe account."
        note="Every paid plan includes payments. No extra processor to set up."
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
        art={
          <BrowserFrame label="app.signerpro.com/payments">
            <PaymentsMock />
          </BrowserFrame>
        }
      />

      {BLOCKS.map((block, index) => {
        const Art = BLOCK_ART[index % BLOCK_ART.length];
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
            <BrowserFrame label={`app.signerpro.com/${block.eyebrow.toLowerCase().replace(/\s+/g, '-')}`}>
              <Art />
            </BrowserFrame>
          }
        />
        );
      })}

      <Faq
        items={FAQ}
        title="Questions about getting paid"
        lead="The things people ask before they connect Stripe."
      />

      <CtaBand
        title="Send a document with a price on it"
        lead="Upload a PDF, add a payment request, and send one link. The signature and the payment come back together."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
