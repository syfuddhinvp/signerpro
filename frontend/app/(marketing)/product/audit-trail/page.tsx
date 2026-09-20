/**
 * Audit trail product page.
 *
 * Every claim maps to FEATURES.md §8 (immutable audit log with IP + user
 * agent, audit certificate, SHA-256, public /verify/{id}, PAdES, DLP, GDPR
 * erasure).
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
  AuditMock,
  PrepareMock,
  RoutingMock,
} from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Proof anyone can check — SignerPro',
  description:
    'An immutable audit log, a certificate sealed into the final PDF, and a public verification page that works without an account.',
};

const BLOCKS = [
  {
    // FEATURES.md §8 — immutable audit log, IP + user agent.
    eyebrow: 'The log',
    title: 'Every view and every click, timestamped against a person.',
    body:
      'Each open, field change, signature and decline is written to an audit log that cannot be edited afterward, along with the IP address and browser that made it.',
    points: [
      'An immutable entry for every document, recipient and signing action',
      'IP address and user agent recorded against each entry',
      'A per-user audit trail you can review even outside a single document',
    ],
  },
  {
    // FEATURES.md §8 — certificate, SHA-256, PAdES.
    eyebrow: 'The document',
    title: 'The proof travels inside the PDF.',
    body:
      'When a document completes, an audit certificate is appended to the final PDF and a SHA-256 hash is taken of both the original and the finished file, so any copy can be checked against it.',
    points: [
      'Audit certificate appended to the sealed PDF',
      'SHA-256 hashes on the original and final document',
      'PAdES digital signing so the final PDF meets signed-document conformance',
    ],
  },
  {
    // FEATURES.md §8 — public /verify/{id}, DLP, GDPR erasure.
    eyebrow: 'The check',
    title: 'Anyone can verify it, with no account.',
    body:
      'A public verification page confirms a document is the one that was signed: the hash, the signers and the completion time. Behind the scenes, uploads are scanned for sensitive data and a tenant can request erasure under GDPR.',
    points: [
      'A public /verify page a third party can open without logging in',
      'DLP scanning with findings recorded against the document',
      'A GDPR-style right-to-erasure endpoint for personal data',
    ],
    link: { href: '/product/payments', label: 'See how payments are proven too' },
  },
];

const FAQ = [
  {
    q: 'What exactly does the audit log record?',
    a: 'Every view, field change, signature and decline, each stamped with who did it, when, their IP address and their browser. Entries cannot be edited after the fact.',
  },
  {
    q: 'What can a third party check on the verification page?',
    a: 'They can confirm the document matches the hash taken at completion, see who signed it, and see when it finished, all without needing an account.',
  },
  {
    q: 'Is the final PDF a standard signed PDF?',
    a: 'Yes. It is processed through a PAdES digital signing step for signed-document conformance, with the audit certificate appended.',
  },
  {
    q: 'What happens if a document contains sensitive data?',
    a: 'Uploads are scanned by a DLP process and any findings are recorded, so your team can see what was flagged before it goes out.',
  },
  {
    q: 'Can someone ask me to delete their data?',
    a: 'Yes. A GDPR-style right-to-erasure endpoint lets you act on that request for personal data held in the system.',
  },
];

/** Product mocks stand in until real captures exist; see
 *  `components/marketing/mocks.tsx` and `scripts/marketing-screenshots.mjs`. */
const BLOCK_ART = [RoutingMock, PrepareMock, ApiMock];

export default function AuditTrailPage() {
  return (
    <>
      <Hero
        eyebrow="Audit trail"
        title="Hand anyone the proof, not just a signature."
        lead="Every action on a document is logged, timestamped and locked. The finished PDF carries its own certificate, and anyone can check it without an account."
        note="Verification is public and free to use, on every plan."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/verify" variant="on-dark" size="lg">
              Try the verification page
            </Cta>
          </CtaRow>
        }
        art={
          <BrowserFrame label="signerpro.com/verify/doc_8f2c">
            <AuditMock />
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
            <BrowserFrame label={`app.signerpro.com/${block.eyebrow.toLowerCase()}`}>
              <Art />
            </BrowserFrame>
          }
        />
        );
      })}

      <Faq
        items={FAQ}
        title="Questions about the audit trail"
        lead="What gets recorded, and who can see it."
      />

      <CtaBand
        title="Send a document you can prove later"
        lead="The trail is built in from the first open. There is nothing extra to turn on."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
