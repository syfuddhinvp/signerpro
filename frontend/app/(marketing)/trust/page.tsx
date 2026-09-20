/**
 * Trust center — the one page that gathers security posture, subprocessors,
 * and the public verification page in one place. The verify explainer is
 * deliberately the most prominent block on the page: it is a proof asset a
 * visitor can use themselves, without an account, which most competitors do
 * not offer at all.
 */
import type { Metadata } from 'next';
import { Hero, Section, Container, SectionHeader, Grid, Card, Cta, CtaRow, CtaBand } from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Trust center — SignerPro',
  description:
    'SignerPro’s trust center: compliance status, subprocessors, and the public verification page that lets anyone check a signed document without an account.',
};

// Bump this whenever the tables on this page change.
const LAST_UPDATED = 'September 20, 2026';

const HERO = {
  eyebrow: 'Trust center',
  title: 'Everything we can tell you about how SignerPro handles your documents',
  lead:
    'This page is the honest version: what we run today, who else touches your data, and a link anyone can use to check a signed document for themselves.',
};

const COMPLIANCE: { name: string; status: string }[] = [
  { name: 'TLS in transit', status: 'In place' },
  { name: 'Secrets encrypted at rest (AES-256-GCM)', status: 'In place' },
  { name: 'Tenant data isolation', status: 'In place' },
  { name: 'SAML SSO, SCIM, MFA, passkeys', status: 'In place' },
  { name: 'Immutable audit log with IP and user agent', status: 'In place' },
  { name: 'SHA-256 document hashing and audit certificate', status: 'In place' },
  { name: 'PAdES digital signing', status: 'In place' },
  { name: 'GDPR right-to-erasure endpoint', status: 'In place' },
  { name: 'SOC 2 Type II', status: 'Not certified — in progress' },
  { name: 'ISO 27001', status: 'Not certified — planned' },
  { name: 'HIPAA', status: 'Not certified' },
];

type Subprocessor = { name: string; purpose: string };

const SUBPROCESSORS: Subprocessor[] = [
  { name: 'Stripe', purpose: 'Payment processing for signer payments and subscription billing.' },
  // TODO(ops-team): confirm final vendor and add to this list before launch.
  { name: 'Email delivery provider — to be confirmed', purpose: 'Transactional email: invitations, reminders, receipts.' },
  // TODO(ops-team): confirm final vendor and add to this list before launch.
  { name: 'SMS delivery provider — to be confirmed', purpose: 'OTP codes and signing reminders sent by text, where enabled.' },
  // TODO(ops-team): confirm final vendor and add to this list before launch.
  { name: 'Cloud hosting provider — to be confirmed', purpose: 'Application hosting, database, and file storage.' },
];

const DOCUMENTS_ON_REQUEST = [
  'A summary of our current security controls',
  'Our data processing terms',
  'A subprocessor change notice, if you want to be told before we add one',
];

export default function TrustPage() {
  return (
    <>
      <Hero
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        lead={HERO.lead}
        actions={
          <CtaRow>
            <Cta href="/security" size="lg">
              Read the security page
            </Cta>
            <Cta href="/legality" variant="on-dark" size="lg">
              Read about e-signature legality
            </Cta>
          </CtaRow>
        }
      />

      <Section tone="band">
        <Container width="prose">
          <SectionHeader
            tone="dark"
            eyebrow="Verify a document"
            title="Anyone can check a signed document, without an account"
            lead="Every finished document gets a public verification link. Open it and you see the document hash, who signed, and when it was completed, checked against what we recorded at the time."
          />
          <div className="text-center">
            <Cta href="/verify" size="lg">
              Open the verification page
            </Cta>
          </div>
        </Container>
      </Section>

      <Section tone="canvas">
        <Container>
          <SectionHeader
            eyebrow="Compliance status"
            title="What we hold, in one table"
            lead="The full detail, with why each row is where it is, is on the security page."
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
                </tr>
              </thead>
              <tbody>
                {COMPLIANCE.map(row => (
                  <tr key={row.name} className="border-b border-mk-hairline last:border-b-0">
                    <th scope="row" className="px-5 py-3 align-top text-mk-copy-sm font-semibold text-mk-ink">
                      {row.name}
                    </th>
                    <td className="px-5 py-3 align-top text-mk-copy-sm text-mk-ink-muted">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      <Section tone="alt">
        <Container>
          <SectionHeader
            eyebrow="Subprocessors"
            title="Who else touches your data"
            lead="A subprocessor is a company we use to run part of the service. This is the current list."
          />
          <div className="overflow-x-auto rounded-mk-card border border-mk-hairline">
            <table className="w-full border-collapse bg-mk-card text-left">
              <thead>
                <tr className="border-b border-mk-hairline bg-mk-canvas-alt">
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    Subprocessor
                  </th>
                  <th scope="col" className="px-5 py-3 text-mk-copy-sm font-bold text-mk-ink">
                    What it does
                  </th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map(row => (
                  <tr key={row.name} className="border-b border-mk-hairline last:border-b-0">
                    <th scope="row" className="px-5 py-3 align-top text-mk-copy-sm font-semibold text-mk-ink">
                      {row.name}
                    </th>
                    <td className="px-5 py-3 align-top text-mk-copy-sm text-mk-ink-muted">{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </Section>

      <Section tone="canvas">
        <Container>
          <SectionHeader
            eyebrow="On request"
            title="Documents we can share directly"
            lead="Ask your account contact, or write to us, and we will send these over."
          />
          <Grid columns={3}>
            {DOCUMENTS_ON_REQUEST.map(item => (
              <Card key={item}>
                <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{item}</p>
              </Card>
            ))}
          </Grid>
          <p className="mt-mk-stack-lg mb-0 text-center text-mk-copy-xs text-mk-ink-subtle">
            Last updated {LAST_UPDATED}.
          </p>
        </Container>
      </Section>

      <CtaBand
        title="Start with a document you can prove"
        lead="Every plan includes the same audit trail, hashing, and public verification link described above."
        secondary={{ href: '/security', label: 'Read the security page' }}
      />
    </>
  );
}
