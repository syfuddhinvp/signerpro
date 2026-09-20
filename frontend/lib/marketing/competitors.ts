/**
 * Comparison data for `/vs/<competitor>` and `/alternatives/<competitor>`.
 *
 * Every figure here was read off the competitor's own pricing page on
 * 2026-09-20 and is recorded with its source in `MARKETING_RESEARCH.md`
 * section 1.2. Two rules govern this file, and both exist because a comparison
 * page that a reader catches out is worse than no comparison page:
 *
 *  1. **Dated and sourced.** Prices move. Each entry carries `checkedOn` and a
 *     `source` URL, and the page prints both, so a stale figure is visibly
 *     stale rather than quietly wrong.
 *  2. **They have to win something.** Every entry needs at least one row with
 *     `theirWin: true`, naming a real advantage. `assertHonest` enforces it at
 *     module load, so a page cannot ship without one.
 *
 * Nothing here describes a SignerPro capability that `FEATURES.md` does not
 * list.
 */
import type { CompareRow } from '@/components/marketing';

export type Competitor = {
  slug: string;
  name: string;
  /** The one-line reason someone is looking for an alternative. */
  wedge: string;
  /** Their entry paid price, as printed on their pricing page. */
  entryPrice: string;
  /** The limit their pricing page does not lead with. */
  cap: string;
  source: string;
  checkedOn: string;
  rows: CompareRow[];
  /** Fair summary of who should stay with them. */
  stayIf: string;
};

const CHECKED = '20 September 2026';

export const COMPETITORS: Competitor[] = [
  {
    slug: 'docusign',
    name: 'DocuSign',
    wedge:
      'The envelope allowance and the per-transaction fees are what most teams are trying to get away from.',
    entryPrice: '$30 per user per month on Standard, billed annually',
    cap: '100 envelopes per user per year, with overage billed on top',
    source: 'https://ecom.docusign.com/plans-and-pricing/esignature',
    checkedOn: CHECKED,
    stayIf:
      'You need a name that a procurement team already has on an approved-vendor list, a thousand pre-built integrations, or notary and Part 11 workflows today.',
    rows: [
      {
        feature: 'Documents you can send',
        us: 'Unlimited on every paid plan',
        them: '100 envelopes per user per year on Standard and Business Pro',
        note: 'Roughly eight a month before overage.',
      },
      {
        feature: 'Collect payment while signing',
        us: 'Every paid plan, through your own Stripe account',
        them: 'Business Pro, at $45 per user per month',
      },
      {
        feature: 'Single sign-on',
        us: 'Every paid plan',
        them: 'Enhanced Plans only, priced by sales',
      },
      {
        feature: 'API and webhooks',
        us: 'Every paid plan, with a published price per document',
        them: 'Separate developer plans',
      },
      {
        feature: 'Public verification link',
        us: 'Anyone can check a document with no account',
        them: 'No public verification page',
      },
      {
        feature: 'Text message delivery',
        us: 'Included in your plan',
        them: 'From $0.36 per message',
      },
      {
        feature: 'Identity verification',
        us: 'Email and text message codes, included',
        them: 'From $2.40 per attempt',
      },
      {
        feature: 'Pre-built integrations',
        us: 'A handful, plus the API and webhooks',
        them: 'More than a thousand',
        theirWin: true,
      },
      {
        feature: 'Notary and 21 CFR Part 11',
        us: 'Not offered',
        them: 'Available on Enhanced Plans',
        theirWin: true,
      },
    ],
  },
  {
    slug: 'dropbox-sign',
    name: 'Dropbox Sign',
    wedge: 'Simple to use, but there is no way to take money and the API is metered hard.',
    entryPrice: '$15 per month for one user, or $25 per user on Standard',
    cap: 'Five templates on Essentials, fifteen on Standard; API billed per request',
    source: 'https://sign.dropbox.com/products/dropbox-sign/pricing',
    checkedOn: CHECKED,
    stayIf:
      'Your team lives in Dropbox and you only need straightforward signing, where its ease of use is genuinely hard to beat.',
    rows: [
      {
        feature: 'Collect payment while signing',
        us: 'Every paid plan, through your own Stripe account',
        them: 'Not available',
      },
      {
        feature: 'Templates',
        us: 'Unlimited on every paid plan',
        them: 'Five on Essentials, fifteen on Standard',
      },
      {
        feature: 'API pricing',
        us: 'Included, with a published price per document past the allowance',
        them: '$75 a month for 50 requests',
      },
      {
        feature: 'Public verification link',
        us: 'Anyone can check a document with no account',
        them: 'No public verification page',
      },
      {
        feature: 'Documents you can send',
        us: 'Unlimited on every paid plan',
        them: 'Unlimited on paid plans',
        note: 'A genuine match, and one of the few in this table.',
      },
      {
        feature: 'Ease of use',
        us: 'Newer product, smaller track record',
        them: 'Rated top for ease of use by G2 three years running',
        theirWin: true,
      },
      {
        feature: 'Dropbox integration',
        us: 'Not offered',
        them: 'Built into Dropbox',
        theirWin: true,
      },
    ],
  },
  {
    slug: 'pandadoc',
    name: 'PandaDoc',
    wedge: 'Strong proposal tooling, but the API and single sign-on are enterprise-only add-ons.',
    entryPrice: '$19 per user per month on Starter, billed annually',
    cap: 'Five templates on Starter; API, Salesforce, bulk send and HIPAA are paid add-ons',
    source: 'https://www.pandadoc.com/pricing/',
    checkedOn: CHECKED,
    stayIf:
      'You are writing sales proposals and quotes rather than sending contracts, where its editor, pricing tables and deal rooms have no equivalent here.',
    rows: [
      {
        feature: 'API and webhooks',
        us: 'Every paid plan',
        them: 'Enterprise only',
      },
      {
        feature: 'Single sign-on',
        us: 'Every paid plan',
        them: 'Enterprise only',
      },
      {
        feature: 'Collect payment while signing',
        us: 'Every paid plan',
        them: 'Business, at $49 per user per month',
      },
      {
        feature: 'Add-ons to reach a full feature set',
        us: 'None. One price, everything included',
        them: 'API, Salesforce, bulk send, web forms, HIPAA, notary and CPQ are separate',
      },
      {
        feature: 'Public verification link',
        us: 'Anyone can check a document with no account',
        them: 'No public verification page',
      },
      {
        feature: 'Proposals, quotes and pricing tables',
        us: 'Not offered',
        them: 'A content library, pricing tables and a proposal editor',
        theirWin: true,
      },
      {
        feature: 'CRM integrations',
        us: 'Through the API and webhooks',
        them: 'Native HubSpot, Pipedrive and Salesforce',
        theirWin: true,
      },
    ],
  },
  {
    slug: 'signnow',
    name: 'signNow',
    wedge: 'Cheap per seat, but the invite allowance and the Site License wall catch teams late.',
    entryPrice: '$8 per user per month on Business, billed annually',
    cap: '100 signature invites per user per year, then $1.50 each',
    source: 'https://www.signnow.com/pricing',
    checkedOn: CHECKED,
    stayIf:
      'You need the cheapest possible per-seat price for straightforward signing and you will stay under the invite allowance.',
    rows: [
      {
        feature: 'Documents you can send',
        us: 'Unlimited on every paid plan',
        them: '100 invites per user per year, then $1.50 each',
      },
      {
        feature: 'API and webhooks',
        us: 'Every paid plan',
        them: 'Site License, priced by sales',
      },
      {
        feature: 'Single sign-on',
        us: 'Every paid plan',
        them: 'Site License, priced by sales',
      },
      {
        feature: 'Published pricing',
        us: 'Every price on one page, including usage',
        them: 'Plan pricing loads in a separate application',
      },
      {
        feature: 'Public verification link',
        us: 'Anyone can check a document with no account',
        them: 'No public verification page',
      },
      {
        feature: 'Entry price per seat',
        us: 'Higher',
        them: '$8 per user per month is the lowest in this comparison',
        theirWin: true,
      },
      {
        feature: 'Form library',
        us: 'Your own templates and a shared catalogue',
        them: 'Tens of thousands of ready-made forms',
        theirWin: true,
      },
    ],
  },
  {
    slug: 'adobe-acrobat-sign',
    name: 'Adobe Acrobat Sign',
    wedge: 'Signing is a feature of Acrobat, and the transaction limit is not on the pricing page.',
    entryPrice: '$16.99 per licence per month on Acrobat Standard for teams',
    cap: '150 transactions per user per year; cancelling early costs half the remaining term',
    source: 'https://www.adobe.com/acrobat/business/pricing.html',
    checkedOn: CHECKED,
    stayIf:
      'Your team already pays for Acrobat and needs its PDF editing more than it needs signing features.',
    rows: [
      {
        feature: 'Documents you can send',
        us: 'Unlimited on every paid plan',
        them: '150 transactions per user per year',
        note: 'Published in a help article, not on the pricing page.',
      },
      {
        feature: 'Cancelling',
        us: 'Monthly, no penalty',
        them: 'Half the remaining annual commitment after 14 days',
      },
      {
        feature: 'API access',
        us: 'Every paid plan',
        them: 'Enterprise and developer accounts only',
      },
      {
        feature: 'Collect payment while signing',
        us: 'Every paid plan',
        them: 'Not available',
      },
      {
        feature: 'Public verification link',
        us: 'Anyone can check a document with no account',
        them: 'No public verification page',
      },
      {
        feature: 'PDF editing',
        us: 'Not offered. We sign documents, we do not edit them',
        them: 'The full Acrobat editor',
        theirWin: true,
      },
      {
        feature: 'Certifications',
        us: 'None held yet',
        them: 'FedRAMP, 21 CFR Part 11 and a long certification list',
        theirWin: true,
      },
    ],
  },
];

/**
 * A comparison page that never concedes a point reads as an advert, and a
 * reader stops trusting the rows that *are* true. The rule is checked here
 * rather than in review, so an entry without a concession fails the build.
 */
function assertHonest(entries: Competitor[]): Competitor[] {
  for (const entry of entries) {
    const concessions = entry.rows.filter(row => row.theirWin).length;
    if (concessions < 1) {
      throw new Error(
        `Comparison page /vs/${entry.slug} concedes nothing. ` +
          'Add at least one row with theirWin: true naming a real advantage.',
      );
    }
  }
  return entries;
}

assertHonest(COMPETITORS);

export const bySlug = (slug: string) => COMPETITORS.find(entry => entry.slug === slug);
