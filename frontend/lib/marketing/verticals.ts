/**
 * `/solutions/<vertical>` content.
 *
 * Each entry names the paperwork problem a specific line of work has and says
 * how the product handles it today. Real estate and mortgage get the most
 * detail because that is where the product started (`../project.md`). Every
 * claim here maps to a shipped surface in `FEATURES.md`, named in the comment
 * beside it, the same discipline `lib/marketing/content.ts` and
 * `lib/marketing/competitors.ts` use.
 *
 * `guidesFor` cross-links to `lib/marketing/templates.ts` by `vertical`. A
 * vertical with no matching guide gets an empty array back, and the page
 * skips the related-templates section rather than showing nothing dressed up
 * as something.
 */
import type { FaqItem } from '@/components/marketing';
import { TEMPLATE_GUIDES, type TemplateGuide } from './templates';

export type VerticalWorkflow = {
  name: string;
  /** Who signs, in plain terms. */
  who: string;
  /** Why this drags today, without SignerPro. */
  drag: string;
  /** How SignerPro handles it, naming a real feature. */
  handled: string;
};

export type Vertical = {
  slug: string;
  name: string;
  headline: string;
  /** The one paperwork problem this line of work has. */
  problem: string;
  workflows: VerticalWorkflow[];
  faq: FaqItem[];
};

export const VERTICALS: Vertical[] = [
  {
    slug: 'real-estate',
    name: 'Real estate',
    headline: 'Get the offer signed and the deposit in, in the same session',
    problem:
      'A real estate deal moves through more signatures than any other line of work here: listing, offer, counter, disclosures, and a deposit that usually gets chased separately from the paperwork.',
    workflows: [
      {
        name: 'Listing agreement',
        who: 'Seller signs first, the listing agent counter-signs, the broker approves where the brokerage requires it.',
        drag: 'Listing agreements differ from the last one by a handful of fields, but agents often start from scratch or hunt down last month’s file.',
        // FEATURES.md §3 — templates with usage tracking.
        handled:
          'Save it as a template once. The next listing takes the fields you already placed and nothing else changes.',
      },
      {
        name: 'Purchase agreement and deposit',
        who: 'Buyer signs and pays, the seller counter-signs, the agent is copied without holding up completion.',
        drag: 'The signed agreement and the earnest money usually arrive on two different days, through two different systems.',
        // FEATURES.md §7 — payment fields, Stripe Connect.
        handled:
          'Put a payment field on the buyer’s signature page. The deposit clears in your Stripe account in the same session the agreement is signed.',
      },
      {
        name: 'Multi-party disclosures',
        who: 'Buyer, seller, and sometimes a co-buyer, each with their own initials pages.',
        drag: 'A disclosure packet sent to everyone at once comes back out of order, or a co-buyer signs before the primary buyer has.',
        // FEATURES.md §5 — sequential routing, per-recipient fields.
        handled:
          'Route it sequentially so each party only receives the document once the person ahead of them has signed, and only sees the fields assigned to them.',
      },
      {
        name: 'Proof the deal closed',
        who: 'Anyone who needs to confirm the file is genuine: a lender, a title company, a broker of record.',
        drag: 'A screenshot of a signed PDF is not proof of anything, and re-explaining a paper trail eats a phone call.',
        // FEATURES.md §8 — /verify/{id}, audit certificate.
        handled:
          'Send the verification link. It confirms the hash, the signers, and the completion time without anyone needing an account.',
      },
    ],
    faq: [
      {
        q: 'Can the buyer pay the deposit while signing?',
        a: 'Yes. Add a payment field to the buyer’s page and the deposit is collected in the browser, in your own connected Stripe account, in the same session as the signature.',
      },
      {
        q: 'Can I reuse a listing agreement for every seller?',
        a: 'Yes. Save any document as a template and the fields stay in place. The next listing is a new set of names and numbers, not a new layout.',
      },
      {
        q: 'What happens if the buyer signs but the seller has not counter-signed yet?',
        a: 'Sequential routing holds the document at the seller until the buyer’s turn is complete, so nothing goes out half-agreed.',
      },
      {
        q: 'Can a title company check that a closing packet is genuine?',
        a: 'Yes. Anyone with the verification link can confirm the document’s hash, signers, and completion time with no account required.',
      },
    ],
  },
  {
    slug: 'mortgage',
    name: 'Mortgage',
    headline: 'A disclosure record a regulator would actually accept',
    problem:
      'A mortgage file is mostly required disclosures, each one needing proof that the borrower read it before they accepted it, plus a paper trail that survives an audit years later.',
    workflows: [
      {
        name: 'Required disclosures',
        who: 'Borrower and co-borrower read, consent, and sign; the loan officer counter-signs.',
        drag: 'Proving a borrower actually saw a disclosure before agreeing to it is the part most e-signature tools skip.',
        // FEATURES.md §6 — ESIGN/UETA consent gate before the document is viewable.
        handled:
          'The ESIGN consent gate runs before the document is even readable, so the record shows consent came before the signature, not after.',
      },
      {
        name: 'Identity on the borrower’s side',
        who: 'Borrower and co-borrower, often signing from different locations.',
        drag: 'A signed disclosure with no identity check behind it is weak evidence if a borrower later disputes it.',
        // FEATURES.md §6 — email/SMS OTP identity verification.
        handled:
          'An email or text code verifies the signer before the fields unlock, and that step is logged with everything else.',
      },
      {
        name: 'The audit trail itself',
        who: 'Compliance, underwriting, or an auditor reviewing the file later.',
        drag: 'A mortgage file gets revisited long after closing, and a log that cannot be handed to a third party is not useful when that happens.',
        // FEATURES.md §8 — immutable audit log, IP and user agent, audit certificate.
        handled:
          'Every view and field change is timestamped against the person who made it, with IP and device recorded, and the finished PDF carries an audit certificate.',
      },
      {
        name: 'Proving the file has not changed',
        who: 'Anyone checking the file after closing: a secondary market buyer, an auditor, the borrower’s own attorney.',
        drag: 'Emailing a PDF and a screenshot of a log is not something a third party can verify on their own.',
        // FEATURES.md §8 — SHA-256 hash, /verify/{id}.
        handled:
          'The public verification page confirms the SHA-256 hash and the signers with no login, so anyone can check the file independently.',
      },
    ],
    faq: [
      {
        q: 'Does the borrower have to accept a disclosure before they can sign it?',
        a: 'Yes. The ESIGN/UETA consent screen has to be accepted before the document becomes viewable, and that order is what the audit trail shows.',
      },
      {
        q: 'Is the borrower’s identity checked before they can fill in fields?',
        a: 'Yes, with an email or text message code. The verification step is recorded in the audit log alongside the signature itself.',
      },
      {
        q: 'Can an auditor check a closed file without a SignerPro account?',
        a: 'Yes. The public verification link confirms the document’s hash, its signers, and its completion time to anyone who has it, with no login.',
      },
      {
        q: 'What does the finished PDF actually carry with it?',
        a: 'The signed document, an appended audit certificate, and a SHA-256 hash on both the original and the final file.',
      },
    ],
  },
  {
    slug: 'property-management',
    name: 'Property management',
    headline: 'Lease, deposit and renewal, without three separate steps',
    problem:
      'A property manager runs the same paperwork across dozens of units at once: a lease, a deposit, and renewals on a schedule that never lines up between tenants.',
    workflows: [
      {
        name: 'New lease and deposit',
        who: 'Tenant, and a co-tenant where the lease names more than one, then the landlord or agent counter-signs.',
        drag: 'The lease gets signed and the deposit gets invoiced separately, so move-in stalls on whichever one is slower.',
        // FEATURES.md §7 — payment fields collected during signing.
        handled:
          'A deposit field on the tenant’s page collects the money in the same session as the signature, split across co-tenants if there is more than one.',
      },
      {
        name: 'House rules and initials',
        who: 'Every named tenant, page by page.',
        drag: 'A signature on the last page alone does not prove a tenant saw the pages with the actual obligations on them.',
        // FEATURES.md §4 — required initials fields, per-page placement.
        handled:
          'Require an initial on every page that carries a rule, so a tenant’s acceptance is recorded page by page, not just at the end.',
      },
      {
        name: 'Renewals across a portfolio',
        who: 'Each tenant on their own renewal, sent on their own schedule.',
        drag: 'Renewals land on different dates for different units, and rebuilding the same document each time wastes an afternoon a month.',
        // FEATURES.md §3 — templates.
        handled:
          'A saved lease template goes out again with new dates and rent, without touching the layout, whenever a renewal comes due.',
      },
    ],
    faq: [
      {
        q: 'Can I split a deposit between two tenants on the same lease?',
        a: 'Yes. Assign a deposit field to each tenant so the amount is split and collected from each of them, rather than chasing one person for the total.',
      },
      {
        q: 'Do tenants need to create an account to sign a lease?',
        a: 'No. They receive a link, sign in the browser, and pay any deposit in the same session. Accounts are only for your own team.',
      },
      {
        q: 'Can I reuse the same lease for every unit?',
        a: 'Yes. Save it as a template and the fields, initials and payment field stay where you put them for the next tenant.',
      },
    ],
  },
  {
    slug: 'professional-services',
    name: 'Professional services',
    headline: 'Turn a signed engagement into a paid one',
    problem:
      'A consultancy, agency or firm signs an engagement and then waits for a separate invoice to clear before work starts, which is the gap between a signed contract and a paying client.',
    workflows: [
      {
        name: 'Contractor or engagement agreement',
        who: 'Client sets the scope and signs, the contractor signs and takes any deposit in the same session.',
        drag: 'A deposit due before work starts usually means a second email, a second login, and a few days of waiting.',
        // FEATURES.md §7 — payment fields.
        handled:
          'Add a deposit field to the agreement. It clears in your Stripe account the moment both sides have signed.',
      },
      {
        name: 'Ongoing service agreement',
        who: 'Client signs and pays the first invoice if you take one up front, provider counter-signs.',
        drag: 'The same commercial terms get retyped into every client’s contract, which is where numbers go wrong.',
        // FEATURES.md §3, §4 — templates, fields per recipient.
        handled:
          'Keep the fee and notice period as fields on a saved template, so the wording never changes and only the numbers do.',
      },
      {
        name: 'Scope sign-off',
        who: 'Client initials the scope page, separate from the signature on the main agreement.',
        drag: 'A dispute over what was agreed usually comes down to which version of the scope document was actually attached.',
        // FEATURES.md §4 — required initials.
        handled:
          'Require an initial on the scope page itself, so the record shows exactly which version the client accepted.',
      },
    ],
    faq: [
      {
        q: 'Can a client pay a retainer while signing the engagement letter?',
        a: 'Yes. A payment field on the client’s page collects the retainer in the same session as the signature, through your own Stripe account.',
      },
      {
        q: 'Can I attach a certificate of insurance for a contractor to upload?',
        a: 'Yes, with an attachment field. The contractor uploads the file on the same page where they sign.',
      },
      {
        q: 'Does every client need the same fields?',
        a: 'No. A saved template keeps the fee, scope and notice period as fields you fill in per client, without rebuilding the layout each time.',
      },
    ],
  },
  {
    slug: 'hr',
    name: 'HR and people teams',
    headline: 'An offer a candidate can accept before someone else’s does',
    problem:
      'An offer letter has to move fast, because a strong candidate is weighing other offers, and every extra field or login is a reason to put it off until tomorrow.',
    workflows: [
      {
        name: 'Offer letter',
        who: 'Hiring manager signs first so the offer arrives already committed, then the candidate signs to accept.',
        drag: 'A PDF offer sent as an attachment sits in an inbox, and a candidate weighing two offers puts off the one that takes longer to deal with.',
        // FEATURES.md §5, §6 — routing order, public signing links, no signer account.
        handled:
          'The candidate opens a link and signs in the browser with no account to create, and a signed offer comes back the same day more often because of it.',
      },
      {
        name: 'Recruiter visibility without a bottleneck',
        who: 'The recruiter or HR business partner tracking the offer.',
        drag: 'Adding a third person as a signer holds the document up on someone who does not need to sign it.',
        // FEATURES.md §5 — copy recipients notified, never block routing.
        handled:
          'Add the recruiter as a copy recipient. They are notified the moment it is signed and never hold up the acceptance.',
      },
      {
        name: 'Onboarding paperwork after acceptance',
        who: 'The new hire, once the offer itself is signed.',
        drag: 'Onboarding forms are usually a fresh batch of documents built from nothing for every new hire.',
        // FEATURES.md §3 — templates, use template to spawn a prepared document.
        handled:
          'Keep the onboarding packet as a saved template so the next new hire’s paperwork is ready in the time it takes to add their name.',
      },
    ],
    faq: [
      {
        q: 'Does a candidate need to make an account to accept an offer?',
        a: 'No. They open the link you send and sign in the browser. Accounts are only for the people on your team preparing offers.',
      },
      {
        q: 'Can I set a deadline on an offer?',
        a: 'Yes. Set an expiry and a reminder on the request, so an offer does not sit open indefinitely.',
      },
      {
        q: 'Should the recruiter be added as a signer?',
        a: 'No, add them as a copy recipient instead. They see the signed offer without being able to hold up the candidate’s acceptance.',
      },
    ],
  },
  {
    slug: 'legal',
    name: 'Legal',
    headline: 'A signature record a court would recognize',
    problem:
      'A firm needs a signing record that stands up if it is ever questioned, which means proof of who signed, when, from where, and that the document has not changed since.',
    workflows: [
      {
        name: 'Retainer and engagement letters',
        who: 'Client signs and pays the retainer, the attorney counter-signs.',
        drag: 'A retainer collected after the engagement letter is signed means a second step, and representation sometimes starts before the money has cleared.',
        // FEATURES.md §7 — payment fields.
        handled:
          'A payment field on the client’s page collects the retainer in the same session as the signature, before work begins.',
      },
      {
        name: 'Multi-party agreements',
        who: 'Each party and their counsel, often signing in a specific order.',
        drag: 'A settlement or multi-party agreement sent to everyone at once tends to come back out of sequence, and a party can claim they signed under a version that was still changing.',
        // FEATURES.md §5 — sequential routing.
        handled:
          'Sequential routing sends the document to each party only once the one before them has signed, so the version everyone signs is the same one.',
      },
      {
        name: 'The record itself',
        who: 'The firm, opposing counsel, or a court reviewing the signing later.',
        drag: 'A dispute over whether a document was actually signed, by whom, and when, usually turns into a discovery request for a paper trail that may not exist.',
        // FEATURES.md §8 — immutable audit log, PAdES, audit certificate.
        handled:
          'Every action is timestamped and attributed in an audit log, the finished PDF carries an appended audit certificate, and the file is PAdES-conformant.',
      },
      {
        name: 'Verifying a filed document later',
        who: 'Opposing counsel, a court clerk, or the firm itself, months or years after signing.',
        drag: 'Re-authenticating an old signed document usually means finding whoever handled it originally.',
        // FEATURES.md §8 — /verify/{id}.
        handled:
          'The public verification page confirms the document’s hash and signers independently of anyone at the firm, at any point afterward.',
      },
    ],
    faq: [
      {
        q: 'Can a retainer be collected at the same time as the engagement letter is signed?',
        a: 'Yes. A payment field on the client’s signature page collects it in the same session, through your own connected Stripe account.',
      },
      {
        q: 'What proves a document has not been altered since it was signed?',
        a: 'A SHA-256 hash on the final file, checkable at any time through the public verification page with no account required.',
      },
      {
        q: 'Is the signing record PAdES-conformant?',
        a: 'Yes, the PAdES digital signing service applies to signed PDFs, and the audit certificate is appended to the finished document.',
      },
      {
        q: 'Can I control the order multiple parties sign in?',
        a: 'Yes, with sequential routing. Each party receives the document only once the person before them has completed their turn.',
      },
    ],
  },
];

export const verticalBySlug = (slug: string) => VERTICALS.find(vertical => vertical.slug === slug);

/** Template guides whose `vertical` matches. Empty when none exist yet. */
export const guidesFor = (slug: string): TemplateGuide[] =>
  TEMPLATE_GUIDES.filter(guide => guide.vertical === slug);
