/**
 * Security page — how documents, accounts and data are protected today.
 *
 * Every claim below names a shipped mechanism and cites the FEATURES.md
 * section it comes from, the same rule the home page follows (see
 * `lib/marketing/content.ts`). Where a certification is not held, this page
 * says so in plain words instead of staying quiet about it. SignerPro does
 * not hold SOC 2, ISO 27001 or HIPAA certification today; see the status
 * table below.
 */
import type { Metadata } from 'next';
import { Hero, Section, Container, SectionHeader, Grid, Card, Display, Faq, CtaBand, Cta, CtaRow } from '@/components/marketing';
import type { FaqItem } from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Security — SignerPro',
  description:
    'How SignerPro protects documents and accounts: encryption, tenant isolation, hashed signer tokens, single sign-on, MFA, passkeys, and an audit trail on every signature.',
};

const HERO = {
  eyebrow: 'Security',
  title: 'How a document stays yours from upload to signature',
  lead:
    'This page names the mechanisms we actually run, not a marketing checklist. Where something is on the roadmap instead of shipped, it is marked as such.',
};

type Topic = { title: string; body: string; feature: string };

// FEATURES.md §20 (multi-tenant isolation), PLATFORM_PLAN.md §1 (tenant scoping).
const TOPICS: Topic[] = [
  {
    title: 'Encryption in transit and at rest',
    body:
      'All traffic to and from SignerPro runs over TLS. Sensitive credentials, such as connected SMTP and SMS gateway secrets, are encrypted at rest with authenticated AES-256-GCM encryption before they touch the database.',
    feature: 'FEATURES.md §20; PLATFORM_PLAN.md §1',
  },
  {
    title: 'Tenant isolation',
    body:
      'Every organization is a separate tenant. Every document, recipient, template and user read is scoped to the requesting organization at the service layer, so one workspace cannot see or list another workspace’s data.',
    feature: 'FEATURES.md §20',
  },
  {
    title: 'Signer token handling',
    body:
      'A signing link is not a password. Only a SHA-256 hash of each signer token is stored, tokens carry an expiry, and a token can be revoked. Every public signing route resolves the token itself rather than trusting a plain ID in the URL.',
    feature: 'PLATFORM_PLAN.md §1',
  },
  {
    title: 'Identity for your team',
    body:
      'Sign in with email and password, or turn on multi-factor authentication, passkeys, or a SAML single sign-on connection scoped to your organization. Team provisioning is available through SCIM so accounts follow your directory automatically.',
    feature: 'FEATURES.md §1',
  },
  {
    title: 'Document integrity',
    body:
      'Every view, field change and signature is written to an audit log with the actor, the time, the IP address and the user agent. The finished PDF is hashed with SHA-256 on completion, carries an appended audit certificate, and can be run through our PAdES digital signing service for signed-PDF conformance.',
    feature: 'FEATURES.md §8',
  },
  {
    title: 'Data handling',
    body:
      'Documents are held for the retention period set on your plan. Uploaded files are scanned for sensitive data with recorded findings, and a GDPR-style right-to-erasure endpoint lets a workspace remove a user’s personal data on request.',
    feature: 'FEATURES.md §8',
  },
  {
    title: 'Infrastructure',
    body:
      'The service runs from containerized infrastructure with a swappable storage layer, so documents can move to object storage as a workspace grows rather than staying tied to a single disk. Feature flags let us roll changes out to one tenant before every tenant.',
    feature: 'FEATURES.md §20',
  },
];

const COMPLIANCE: { name: string; status: string; note: string }[] = [
  { name: 'TLS in transit', status: 'In place', note: 'All traffic to the app and API is encrypted.' },
  { name: 'Secrets encrypted at rest', status: 'In place', note: 'AES-256-GCM for stored gateway and integration credentials.' },
  { name: 'SAML SSO, SCIM, MFA, passkeys', status: 'In place', note: 'Per-tenant SSO connection, scoped SCIM tokens, MFA enrollment, WebAuthn passkeys.' },
  { name: 'Audit trail with IP and user agent', status: 'In place', note: 'Recorded on every document and signing event.' },
  { name: 'SHA-256 document hashing and audit certificate', status: 'In place', note: 'Applied on completion; checkable at a public verification link.' },
  { name: 'PAdES digital signing', status: 'In place', note: 'Available as a signing conformance option.' },
  { name: 'GDPR right-to-erasure endpoint', status: 'In place', note: 'Removes a user’s personal data on request.' },
  // TODO(compliance-team): fill in real target dates once an auditor is engaged.
  { name: 'SOC 2 Type II', status: 'Not certified — in progress', note: 'We do not hold this certification yet. Target date to be set once an audit firm is engaged.' },
  { name: 'ISO 27001', status: 'Not certified — planned', note: 'On the compliance roadmap; no certification exists today.' },
  { name: 'HIPAA', status: 'Not certified', note: 'SignerPro is not currently positioned or certified as a HIPAA business associate.' },
];

const FAQ: FaqItem[] = [
  {
    q: 'Do you hold SOC 2 or ISO 27001?',
    a: 'No, not yet. We do not hold SOC 2, ISO 27001 or HIPAA certification today. The controls those frameworks describe, like encryption, access logging and tenant isolation, are things we already run; the formal audit and certificate are a roadmap item.',
  },
  {
    q: 'Where are signer tokens stored?',
    a: 'Only a SHA-256 hash of the token is stored, never the token itself. Tokens expire and can be revoked, and every public signing route looks the token up rather than trusting an ID in the link.',
  },
  {
    q: 'Can one workspace see another workspace’s documents?',
    a: 'No. Every read of a document, recipient or user is scoped to the organization making the request at the service layer, so tenants are isolated from each other by default.',
  },
  {
    q: 'What identity options do you support?',
    a: 'Email and password, multi-factor authentication, WebAuthn passkeys, and a SAML single sign-on connection per organization. SCIM provisioning is available so your directory controls who has an account.',
  },
  {
    q: 'How do I check a document is genuine?',
    a: 'Open the public verification page for that document. It checks the SHA-256 hash, lists the signers, and shows the completion time, without needing an account. See our trust center for more on this.',
  },
];

export default function SecurityPage() {
  return (
    <>
      <Hero
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        lead={HERO.lead}
        actions={
          <CtaRow>
            <Cta href="/trust" size="lg">
              See the trust center
            </Cta>
            <Cta href="/legality" variant="on-dark" size="lg">
              Read about e-signature legality
            </Cta>
          </CtaRow>
        }
      />

      <Section tone="canvas">
        <Container>
          <SectionHeader
            eyebrow="How it works"
            title="Seven places we protect a document"
            lead="Each one names a mechanism the product runs today, not an aspiration."
          />
          <Grid columns={3}>
            {TOPICS.map(topic => (
              <Card key={topic.title}>
                <Display level={3} size="sm" className="mb-2">
                  {topic.title}
                </Display>
                <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{topic.body}</p>
              </Card>
            ))}
          </Grid>
        </Container>
      </Section>

      <Section tone="alt">
        <Container>
          <SectionHeader
            eyebrow="Compliance status"
            title="What we hold, and what we do not"
            lead="We would rather state this plainly than let a badge on a footer imply something untrue."
          />
          <div className="overflow-x-auto rounded-mk-card border border-mk-hairline">
            <table className="w-full border-collapse bg-mk-card text-left">
              <thead>
                <tr className="border-b border-mk-hairline bg-mk-canvas-alt">
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    Control or certification
                  </th>
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPLIANCE.map(row => (
                  <tr key={row.name} className="border-b border-mk-hairline last:border-b-0">
                    <th scope="row" className="px-5 py-3 align-top text-mk-copy-sm font-semibold text-mk-ink">
                      {row.name}
                    </th>
                    <td className="px-5 py-3 align-top text-mk-copy-sm text-mk-ink-muted">{row.status}</td>
                    <td className="px-5 py-3 align-top text-mk-copy-sm text-mk-ink-muted">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      <Faq items={FAQ} title="Security questions people ask first" />

      <CtaBand
        title="Read the compliance detail in the trust center"
        lead="Subprocessors, the verification page, and documents we can share on request all live in one place."
        href="/trust"
        label="Open the trust center"
        secondary={{ href: '/register', label: 'Start free' }}
      />
    </>
  );
}
