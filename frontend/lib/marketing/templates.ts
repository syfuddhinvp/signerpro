/**
 * `/templates/<type>` content.
 *
 * The honesty problem these pages had to solve: the shared template catalogue
 * is real (`FEATURES.md` section 3, `backend/app/api/routes/catalog.py`) but it
 * is only readable by a signed-in sender, so a page here cannot offer a
 * download without inventing one.
 *
 * What it can do is the thing that makes a programmatic page worth indexing
 * anyway — say precisely how the document is put together: who signs it, in
 * what order, and which field goes where. That is genuinely useful to somebody
 * about to build it, it is specific per document type rather than a template
 * with the noun swapped, and it is all true. The call to action is to start
 * free and import the form, which is what actually happens.
 *
 * TODO: when `GET /api/templates/catalog` gains a public, unauthenticated
 * listing, render the matching catalogue entry here and link straight into the
 * import flow.
 */

export type TemplateGuide = {
  slug: string;
  /** Page title and H1 subject. */
  name: string;
  /** One line on what the document is for. */
  purpose: string;
  /** Who signs, in routing order. */
  signers: { role: string; does: string }[];
  /** The fields the document needs, by recipient. */
  fields: { field: string; assignedTo: string; required: boolean; note?: string }[];
  /** Whether money usually changes hands at signature. */
  payment?: string;
  /** What to get right, written for someone building it. */
  watchFor: string[];
  vertical?: string;
};

export const TEMPLATE_GUIDES: TemplateGuide[] = [
  {
    slug: 'nda',
    name: 'Non-disclosure agreement',
    purpose:
      'Protects information two parties share before they work together. Usually the first document a deal produces, and the one most often sent as a plain PDF attachment.',
    signers: [
      { role: 'Disclosing party', does: 'Signs first, because they set the terms.' },
      { role: 'Receiving party', does: 'Signs second, after reading what they are agreeing to.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Both parties', required: true },
      { field: 'Full name', assignedTo: 'Both parties', required: true },
      { field: 'Company', assignedTo: 'Both parties', required: true },
      { field: 'Date signed', assignedTo: 'Both parties', required: true, note: 'Fills itself in when they sign.' },
      { field: 'Term in years', assignedTo: 'Disclosing party', required: false, note: 'Leave editable if you negotiate it.' },
    ],
    watchFor: [
      'Send it in order, not to both at once, so the receiving party sees a document that is already committed to.',
      'A mutual agreement needs the same fields twice, one set per side. Assign each set to its own recipient or people will sign in the wrong box.',
      'Set an expiry on the request. An unsigned agreement sitting open for months is a loose end.',
    ],
  },
  {
    slug: 'lease-agreement',
    name: 'Residential lease agreement',
    purpose:
      'Sets the terms between a landlord and a tenant. Often signed alongside a deposit, which is the part that usually happens separately and slowly.',
    signers: [
      { role: 'Tenant', does: 'Signs first and pays the deposit in the same session.' },
      { role: 'Co-tenant', does: 'Signs if the lease names more than one.' },
      { role: 'Landlord or agent', does: 'Counter-signs once the tenants have.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Every tenant and the landlord', required: true },
      { field: 'Full name', assignedTo: 'Every tenant', required: true },
      { field: 'Address', assignedTo: 'Tenant', required: true },
      { field: 'Monthly rent', assignedTo: 'Landlord', required: true },
      { field: 'Start and end date', assignedTo: 'Landlord', required: true },
      { field: 'Initials', assignedTo: 'Tenant', required: true, note: 'On the pages that carry house rules.' },
      { field: 'Deposit amount', assignedTo: 'Tenant', required: true, note: 'A payment field, collected at signature.' },
    ],
    payment:
      'The deposit is the reason this document drags. Collect it as a payment field inside the signing session and the lease and the money complete together.',
    watchFor: [
      'Split the deposit across co-tenants rather than chasing one person for the whole amount.',
      'Put initials on every page that carries an obligation. A signature on the last page alone is weaker.',
      'Route it so the landlord counter-signs last, which means a countersigned lease never goes out before the tenant has committed.',
    ],
    vertical: 'real-estate',
  },
  {
    slug: 'offer-letter',
    name: 'Employment offer letter',
    purpose:
      'Offers a role and records the terms the candidate accepts. Speed matters more here than on any other document, because a good candidate has other offers.',
    signers: [
      { role: 'Hiring manager', does: 'Signs first so the offer arrives already committed.' },
      { role: 'Candidate', does: 'Signs to accept.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Both', required: true },
      { field: 'Full name', assignedTo: 'Candidate', required: true },
      { field: 'Start date', assignedTo: 'Candidate', required: true, note: 'Let them propose it rather than fixing it.' },
      { field: 'Salary', assignedTo: 'Hiring manager', required: true },
      { field: 'Job title', assignedTo: 'Hiring manager', required: true },
      { field: 'Date signed', assignedTo: 'Both', required: true },
    ],
    watchFor: [
      'Copy the recruiter rather than adding them as a signer, so they see the acceptance without blocking it.',
      'Keep the candidate to two fields if you can. Every extra field is a reason to put it off until the evening.',
      'Set a short expiry and a reminder. An offer with no deadline gets used as leverage elsewhere.',
    ],
    vertical: 'hr',
  },
  {
    slug: 'contractor-agreement',
    name: 'Independent contractor agreement',
    purpose:
      'Engages someone who is not an employee. Usually needs a deposit before work starts, and usually gets it late.',
    signers: [
      { role: 'Client', does: 'Signs and sets the scope.' },
      { role: 'Contractor', does: 'Signs and takes the deposit in the same session.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Both', required: true },
      { field: 'Full name', assignedTo: 'Both', required: true },
      { field: 'Company', assignedTo: 'Contractor', required: false },
      { field: 'Rate', assignedTo: 'Client', required: true },
      { field: 'Scope of work', assignedTo: 'Client', required: true },
      { field: 'Deposit', assignedTo: 'Client', required: false, note: 'A payment field if you take money up front.' },
    ],
    payment:
      'If you take a deposit before starting, collect it during signing. It removes the invoice, the reminder and the week between them.',
    watchFor: [
      'Attach the scope as its own page and require an initial on it, so nobody argues later about which version was agreed.',
      'Use an attachment field if you need a certificate of insurance back at the same time.',
    ],
    vertical: 'professional-services',
  },
  {
    slug: 'purchase-agreement',
    name: 'Purchase agreement',
    purpose:
      'Records a sale and its conditions. Often has more than two parties and an order they have to sign in.',
    signers: [
      { role: 'Buyer', does: 'Signs first and pays any deposit.' },
      { role: 'Seller', does: 'Counter-signs.' },
      { role: 'Agent or broker', does: 'Receives a copy without blocking completion.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Buyer and seller', required: true },
      { field: 'Full name', assignedTo: 'Buyer and seller', required: true },
      { field: 'Purchase price', assignedTo: 'Seller', required: true },
      { field: 'Closing date', assignedTo: 'Seller', required: true },
      { field: 'Initials', assignedTo: 'Buyer', required: true },
      { field: 'Deposit', assignedTo: 'Buyer', required: false },
    ],
    payment: 'A deposit taken at signature turns a signed intention into a committed sale.',
    watchFor: [
      'Add the agent as a copy recipient, not a signer. A copy recipient is notified and never holds the document up.',
      'Sequence it so the seller counter-signs last.',
    ],
    vertical: 'real-estate',
  },
  {
    slug: 'listing-agreement',
    name: 'Listing agreement',
    purpose: 'Appoints an agent to sell a property and sets the commission.',
    signers: [
      { role: 'Seller', does: 'Signs first.' },
      { role: 'Listing agent', does: 'Counter-signs.' },
      { role: 'Broker', does: 'Approves where the brokerage requires it.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Seller and agent', required: true },
      { field: 'Full name', assignedTo: 'Seller', required: true },
      { field: 'Address', assignedTo: 'Seller', required: true },
      { field: 'Commission rate', assignedTo: 'Agent', required: true },
      { field: 'Listing period', assignedTo: 'Agent', required: true },
      { field: 'Initials', assignedTo: 'Seller', required: true },
    ],
    watchFor: [
      'If the brokerage requires sign-off, add the broker as an approver rather than a signer.',
      'Save it as a template once. Listing agreements differ by a handful of fields and nothing else.',
    ],
    vertical: 'real-estate',
  },
  {
    slug: 'service-agreement',
    name: 'Service agreement',
    purpose: 'Sets out ongoing work, what it costs and how either side ends it.',
    signers: [
      { role: 'Client', does: 'Signs and pays the first invoice if you take one up front.' },
      { role: 'Provider', does: 'Counter-signs.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Both', required: true },
      { field: 'Full name', assignedTo: 'Both', required: true },
      { field: 'Company', assignedTo: 'Both', required: true },
      { field: 'Monthly fee', assignedTo: 'Provider', required: true },
      { field: 'Notice period', assignedTo: 'Provider', required: true },
      { field: 'First payment', assignedTo: 'Client', required: false },
    ],
    payment: 'Taking the first month during signing is the difference between a signed contract and a paying client.',
    watchFor: [
      'Keep the commercial terms in fields rather than in the body text, so the same template serves every client.',
    ],
    vertical: 'professional-services',
  },
  {
    slug: 'mortgage-disclosure',
    name: 'Mortgage disclosure',
    purpose:
      'Puts required disclosures in front of a borrower and records that they read and accepted them.',
    signers: [
      { role: 'Borrower', does: 'Reads, consents and signs.' },
      { role: 'Co-borrower', does: 'Signs where there is one.' },
      { role: 'Loan officer', does: 'Counter-signs.' },
    ],
    fields: [
      { field: 'Signature', assignedTo: 'Every borrower', required: true },
      { field: 'Full name', assignedTo: 'Every borrower', required: true },
      { field: 'Date signed', assignedTo: 'Every borrower', required: true },
      { field: 'Initials', assignedTo: 'Every borrower', required: true, note: 'On each disclosure page.' },
    ],
    watchFor: [
      'This is the document where the audit trail matters most. Every view and every field change is timestamped against the person who made it.',
      'The consent gate runs before the document is readable, so the record shows the disclosure was accepted before anything was signed.',
      'Verify a completed file with a public link rather than emailing a screenshot of a log.',
    ],
    vertical: 'mortgage',
  },
];

export const templateBySlug = (slug: string) =>
  TEMPLATE_GUIDES.find(guide => guide.slug === slug);
