/**
 * Routing product page.
 *
 * Every claim maps to FEATURES.md §5 (recipient roles, parallel/sequential
 * routing, drag reorder, bulk add, per-recipient resend, reassignment, statuses).
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
  PrepareMock,
  RoutingMock,
  TemplatesMock,
} from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Route it the way the deal closes — SignerPro',
  description:
    'Send to everyone at once or in order, give each recipient the right role, and reorder, resend or reassign without starting over.',
};

const BLOCKS = [
  {
    // FEATURES.md §5 — recipient roles, only signers gate completion.
    eyebrow: 'Roles',
    title: 'Not everyone in the room needs to sign.',
    body:
      'Give each recipient the role that matches what they actually do: sign, approve, get a copy, or sign in person on your device. Only signing roles hold up completion.',
    points: [
      'Sign, approve, copy (CC) and in-person roles on the same document',
      'CC recipients are notified and never block the document from completing',
      'Approvers can hold up a document without needing to sign it themselves',
    ],
  },
  {
    // FEATURES.md §5 — parallel/sequential, drag reorder, bulk add.
    eyebrow: 'Order',
    title: 'Everyone at once, or one after another.',
    body:
      'Choose parallel routing when order does not matter, or sequential when it does, so the counter-signature only goes out once the customer has signed. Drag to reorder before you send.',
    points: [
      'Parallel and sequential workflow types on the same document',
      'Routing order set by dragging recipients into place',
      'Add a batch of recipients at once instead of one at a time',
    ],
  },
  {
    // FEATURES.md §5 — resend, copy link, reassignment, statuses.
    eyebrow: 'While it is out',
    title: 'Nudge, resend or reroute without starting over.',
    body:
      'Once a document is sent, the audit trail shows exactly where each recipient stands. Resend to one person, copy their signing link, or let them hand their turn to a colleague.',
    points: [
      'Per-recipient resend and signing-link copy from the audit trail',
      'A recipient can reassign their turn without you resending the document',
      'Statuses track each recipient: waiting, sent, viewed, completed, declined, expired',
    ],
    link: { href: '/product/audit-trail', label: 'See what the trail records' },
  },
];

const FAQ = [
  {
    q: 'What is the difference between sequential and parallel routing?',
    a: 'Parallel sends the document to every signer at once. Sequential sends it in order, so the next recipient only gets it once the one before them has signed.',
  },
  {
    q: 'Can a recipient pass their turn to someone else?',
    a: 'Yes. A recipient can reassign their signing turn to a colleague from the signing page itself, without you having to resend the document.',
  },
  {
    q: 'Do CC recipients slow down completion?',
    a: 'No. Copy (CC) recipients are notified when the document is sent and when it completes, but they never gate the routing the way a signer or approver does.',
  },
  {
    q: 'What if I send to the wrong order?',
    a: 'Reorder recipients by dragging them into the sequence you want before sending. Once sent, you can still resend or reassign an individual recipient.',
  },
  {
    q: 'Can I add a lot of recipients at once?',
    a: 'Yes, bulk recipient add lets you bring in a group in one step instead of adding each person individually.',
  },
];

/** Product mocks stand in until real captures exist; see
 *  `components/marketing/mocks.tsx` and `scripts/marketing-screenshots.mjs`. */
const BLOCK_ART = [PrepareMock, AuditMock, TemplatesMock];

export default function RoutingPage() {
  return (
    <>
      <Hero
        eyebrow="Routing"
        title="Route it the way the deal actually closes."
        lead="Assign a role to every recipient, choose the order they sign in, and change either one without resending the whole document."
        note="Sequential and parallel routing are on every plan."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Start free
            </Cta>
            <Cta href="/product/audit-trail" variant="on-dark" size="lg">
              See the audit trail
            </Cta>
          </CtaRow>
        }
        art={
          <BrowserFrame label="app.signerpro.com/routing">
            <RoutingMock />
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
        title="Questions about routing"
        lead="The things people ask before they send to more than one recipient."
      />

      <CtaBand
        title="Send to more than one person the right way"
        lead="Assign roles, set the order, and let the document route itself."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
