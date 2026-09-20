/**
 * Branding product page.
 *
 * Every claim maps to FEATURES.md §11 (per-org branding themes, logo,
 * public brand/logo endpoints) and §15 (embedding, frame-ancestors allowlist,
 * standalone embed surface).
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
  ApiMock,
  BrandingMock,
  TemplatesMock,
  PrepareMock,
} from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Your logo, your colours, your signing page — SignerPro',
  description:
    'Set your logo and colour once and they carry through the signing page, the emails your recipients get, and an embedded flow inside your own product.',
};

const BLOCKS = [
  {
    // FEATURES.md §11 — per-org branding themes, logo upload/removal.
    eyebrow: 'One theme, everywhere',
    title: 'Set your colour and logo once.',
    body:
      'Upload your logo and pick your accent colour in a branding theme, and it applies across the workspace. Keep more than one theme if different parts of your business need to look different.',
    points: [
      'Per-org branding themes with colour and logo',
      'Upload or remove your logo at any time',
      'Multiple themes if you send under more than one brand',
    ],
  },
  {
    // FEATURES.md §11 — public brand/logo endpoints used by signing and embed.
    eyebrow: 'It follows the document',
    title: 'The signer sees your brand, not ours.',
    body:
      'The same branding a recipient sees on your signing page also reaches the emails that invite them to sign, so nothing along the way looks like a shared, generic tool.',
    points: [
      'Public brand and logo data feeds the signing page directly',
      'The same branding carries into the emails recipients receive',
      'No SignerPro logo shown to the person you sent the document to',
    ],
    link: { href: '/product/signing', label: 'See the branded signing page' },
  },
  {
    // FEATURES.md §15 — embedding, frame-ancestors allowlist, standalone embed.
    eyebrow: 'Inside your own app',
    title: 'Or skip the redirect and embed it entirely.',
    body:
      'Drop the signing or sending flow into your own product with a scoped, revocable session token, and control which sites are allowed to frame it.',
    points: [
      'Embedded signing and sending sessions with revocable tokens',
      'A frame-ancestors allowlist so you decide who can embed it',
      'A standalone embed surface for a fully hosted, branded experience',
    ],
  },
];

const FAQ = [
  {
    q: 'Which plan includes branding?',
    a: 'Every paid plan. Your logo and accent colour carry into the signing page and the emails your recipients receive.',
  },
  {
    q: 'Can I use different branding for different products or teams?',
    a: 'Yes, you can keep more than one branding theme and apply the one that fits.',
  },
  {
    q: 'Will my customer ever see SignerPro’s own branding?',
    a: 'No. The public signing page and the emails around it use your logo and colour, not a shared skin.',
  },
  {
    q: 'Can I put the signing flow inside my own product?',
    a: 'Yes, through an embedded session with a scoped, revocable token, and a frame-ancestors allowlist so you control which sites can load it.',
  },
  {
    q: 'What if I need to change my logo later?',
    a: 'Upload a new one or remove the current one at any time from your branding settings; the change applies to future signing sessions right away.',
  },
];

/** Product mocks stand in until real captures exist; see
 *  `components/marketing/mocks.tsx` and `scripts/marketing-screenshots.mjs`. */
const BLOCK_ART = [PrepareMock, TemplatesMock, ApiMock];

export default function BrandingPage() {
  return (
    <>
      <Hero
        eyebrow="Branding"
        title="Your logo and colours, on the page your customer sees."
        lead="Set a branding theme once and it carries into the signing page, the emails you send, and an embedded flow inside your own product."
        note="Branding is included on every paid plan."
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
          <BrowserFrame label="app.signerpro.com/settings/branding">
            <BrandingMock />
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
        title="Questions about branding"
        lead="What carries over, and where it shows up."
      />

      <CtaBand
        title="Put your brand on the document your customer signs"
        lead="Upload a logo, pick a colour, and every signing session after that looks like yours."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
