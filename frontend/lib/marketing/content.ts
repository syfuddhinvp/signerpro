/**
 * Home page copy.
 *
 * Kept out of the component so the claims can be read, reviewed and diffed as
 * prose. The standing rule from the page this replaces still governs every
 * line: nothing here describes something the product does not do today. Each
 * block below names a shipped surface, and the FEATURES.md section it comes
 * from is in the comment.
 */
import type { FaqItem } from '@/components/marketing';
import type { Step } from '@/components/marketing';

export const HERO = {
  eyebrow: 'E-signature with payment and proof built in',
  title: 'Send it. Sign it. Get paid for it.',
  lead:
    'Upload a PDF, place the fields, and send one link. Your customer signs and pays in the browser, and you get back a sealed document anyone can verify.',
  note: 'No card to start. Every paid plan includes the API, SSO and your own branding.',
};

/** Four objections, in the order the page answers them. */
export const BLOCKS: {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  link: { href: string; label: string };
}[] = [
  {
    // FEATURES.md §7 — Stripe Connect, split modes, refunds, currencies.
    eyebrow: 'Payments',
    title: 'They sign, they pay, done.',
    body:
      'Connect your own Stripe account and collect a deposit or the full fee inside the signing session. The contract and the money land in the same minute, from the same link.',
    points: [
      'Money moves from the signer straight to your Stripe account',
      'Split an amount across recipients, evenly or line by line',
      'Refund from the payments view without leaving the document',
    ],
    link: { href: '/product/payments', label: 'How payments work' },
  },
  {
    // FEATURES.md §5 — parallel and sequential routing, roles, reassignment.
    eyebrow: 'Routing',
    title: 'Route it the way the deal actually closes.',
    body:
      'Send to everyone at once, or in order, so the counter-signature only goes out once the customer has signed. Each recipient gets their own link and sees only their own fields.',
    points: [
      'Sequential and parallel routing, reordered by dragging',
      'Signers, approvers and CC recipients, with only signers gating completion',
      'A recipient can hand their turn to a colleague without you resending',
    ],
    link: { href: '/product/routing', label: 'How routing works' },
  },
  {
    // FEATURES.md §8 — audit log, certificate, PAdES, /verify.
    eyebrow: 'Proof',
    title: 'Hand anyone the proof.',
    body:
      'Every view, field change and signature is timestamped against the person who made it. The finished PDF carries an audit certificate and a hash, and a public link lets a third party check it without an account.',
    points: [
      'A verification page anyone can open, with no login',
      'Audit certificate appended to the sealed PDF',
      'SHA-256 hashes on the original and the final document',
    ],
    link: { href: '/product/audit-trail', label: 'See what the trail records' },
  },
  {
    // FEATURES.md §1, §11, §14, §15 — SSO, branding, API keys, embedding.
    eyebrow: 'No gates',
    title: 'Nothing held back for a sales call.',
    body:
      'The things other platforms reserve for their top tier are on every paid plan here: the API, webhooks, embedded signing, single sign-on and your own branding on the signing page and the emails.',
    points: [
      'API keys with scopes, webhooks with replay, and a sandbox',
      'SAML single sign-on, SCIM provisioning and passkeys',
      'Your logo and colour on the signing page your customer sees',
    ],
    link: { href: '/developers', label: 'Read the developer docs' },
  },
];

export const STEPS: Step[] = [
  { title: 'Upload', body: 'Bring a PDF, or start from a template your team already uses.' },
  { title: 'Place fields', body: 'Assign every field to the recipient who has to fill it in.' },
  { title: 'Send', body: 'Recipients sign in the browser. No account, nothing to install.' },
  { title: 'Close', body: 'The sealed PDF and its audit trail land back in your workspace.' },
];

export const FAQ: FaqItem[] = [
  {
    q: 'Do the people I send to need an account?',
    a: 'No. A recipient gets a link, opens it in the browser, and signs. Accounts are only for the people on your side who prepare and send documents.',
  },
  {
    q: 'How do payments work?',
    a: 'You connect your own Stripe account, so money moves from the signer to you directly. Your subscription to SignerPro is billed separately, and we never hold your funds.',
  },
  {
    q: 'What can someone check with a verification link?',
    a: 'That the document they are holding is the one that was signed. The page confirms the hash, the signers and the completion time, and it works for anyone you send it to without an account.',
  },
  {
    q: 'Can I use my own branding?',
    a: 'Yes, on every paid plan. Your logo and accent colour carry into the signing page and the emails your recipients receive.',
  },
  {
    q: 'What happens to a document once it is signed?',
    a: 'It is sealed, hashed, stored with its audit trail, and downloadable as a PDF with the audit certificate appended. Retention is set by your plan.',
  },
];
