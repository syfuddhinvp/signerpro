/**
 * Signing product page — the recipient's experience, phone-first.
 *
 * Every claim maps to FEATURES.md §6 (tokenized links with no login,
 * ESIGN/UETA consent gate, email/SMS OTP, draw or type signature, saved
 * signatures, decline with reason, per-signer branding, signer payment).
 */
import type { Metadata } from 'next';
import {
  Hero,
  FeatureBlock,
  Faq,
  CtaBand,
  Cta,
  CtaRow,
  PhoneFrame,
  BrowserFrame,
  AuditMock,
  BrandingMock,
  PaymentsMock,
  SigningMock,
} from '@/components/marketing';

export const metadata: Metadata = {
  title: 'What your signer actually sees — SignerPro',
  description:
    'No account, no app to install. A recipient opens a link on their phone, confirms who they are, signs, and pays if the document asks for it.',
};

const BLOCKS = [
  {
    // FEATURES.md §6 — tokenized links, ESIGN/UETA gate, OTP verification.
    eyebrow: 'Getting in',
    title: 'A link opens straight to the document, nothing to install.',
    body:
      'The link is tied to that recipient, so there is no account to create. Before the document is viewable, they confirm they accept electronic signatures, then verify who they are with a one-time code by email or text.',
    points: [
      'Tokenized signing links with no login required',
      'ESIGN/UETA disclosure gate before the document opens',
      'Identity confirmed with an email or SMS one-time code',
    ],
  },
  {
    // FEATURES.md §6 — draw/type signature, saved signatures, field entry, decline.
    eyebrow: 'Signing',
    title: 'Draw it, type it, or reuse the one already on file.',
    body:
      'A signer draws their signature with a finger or mouse, types it in a styled font, or picks a signature they saved from a previous document. If something is wrong, they can decline and say why instead of just abandoning it.',
    points: [
      'Signature captured by drawing or typing, in a styled typeface',
      'Saved signatures a signer can reuse next time, with a default set',
      'Decline to sign with a reason, so the sender knows what stopped it',
    ],
  },
  {
    // FEATURES.md §6 — per-signer branding, signer payment.
    eyebrow: 'Whose page it is',
    title: 'It looks like your company, not ours.',
    body:
      'The signing page carries your branding, not a generic signing tool skin. If the document has a payment attached, the signer pays right there and sees the result before they finish.',
    points: [
      'Per-signer branding applied to the page they sign on',
      'Signer-side payment collection built into the same session',
      'Payment status refreshes in view, so they see it succeed before finishing',
    ],
    link: { href: '/product/payments', label: 'See how the payment side works' },
  },
];

const FAQ = [
  {
    q: 'Does my customer need to create an account to sign?',
    a: 'No. Their link is tied to them as a recipient. They open it, verify who they are, and sign, with nothing to register.',
  },
  {
    q: 'How is their identity verified?',
    a: 'With a one-time code sent by email or text before the document fields unlock, on top of the unique link itself.',
  },
  {
    q: 'Can they sign from a phone?',
    a: 'Yes, the signing page is built for a phone screen first. Drawing a signature with a finger works the same as drawing with a mouse.',
  },
  {
    q: 'What if they change their mind partway through?',
    a: 'They can decline to sign and give a reason, which is recorded and visible to the sender instead of the document just going quiet.',
  },
  {
    q: 'Will they see my company’s branding or a generic tool?',
    a: 'Your branding. The signing page uses your logo and colours, not a shared, unbranded interface.',
  },
];

/** Product mocks stand in until real captures exist; see
 *  `components/marketing/mocks.tsx` and `scripts/marketing-screenshots.mjs`. */
const BLOCK_ART = [AuditMock, PaymentsMock, BrandingMock];

/* The hero is the signer's phone. These rows show what the *sender* sees while
   that is happening, so they sit in a browser frame at the panel's own 4:3
   rather than being squeezed into a 280px phone. */
const BLOCK_URL = [
  'app.signerpro.com/documents/audit',
  'app.signerpro.com/payments',
  'app.signerpro.com/account/brand',
];

export default function SigningPage() {
  return (
    <>
      <Hero
        eyebrow="Signing"
        title="The signer&rsquo;s view: five taps on a phone."
        lead="No account, no app. A recipient opens their link, proves who they are, signs with a finger, and pays if the document asks for it."
        note="Every signing link works with no recipient account, on every plan."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/product/branding" variant="on-dark" size="lg">
              See branding options
            </Cta>
          </CtaRow>
        }
        art={
          <PhoneFrame label="Signing page preview">
            <SigningMock />
          </PhoneFrame>
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
            <BrowserFrame label={BLOCK_URL[index % BLOCK_URL.length]}>
              <Art />
            </BrowserFrame>
          }
        />
        );
      })}

      <Faq
        items={FAQ}
        title="Questions people ask about the signer's side"
        lead="What the person you send to actually experiences."
      />

      <CtaBand
        title="Send a link your customer can actually sign on their phone"
        lead="Upload a PDF, place the fields, and see what a real signing session looks like."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
