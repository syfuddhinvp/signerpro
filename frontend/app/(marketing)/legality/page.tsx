/**
 * E-signature legality index. Explains the general legal basis for
 * electronic signatures and names where in the product each requirement is
 * satisfied. General information only, not legal advice, as the disclaimer
 * on the page says plainly.
 */
import type { Metadata } from 'next';
import { Hero, Section, Container, SectionHeader, Grid, Card, Display, Faq, CtaBand, Cta, CtaRow } from '@/components/marketing';
import type { FaqItem } from '@/components/marketing';

export const metadata: Metadata = {
  title: 'E-signature legality — SignerPro',
  description:
    'How electronic signature law works under the ESIGN Act, UETA and eIDAS, what makes a signature enforceable, and how SignerPro satisfies each part.',
};

const HERO = {
  eyebrow: 'E-signature legality',
  title: 'What the law asks of an electronic signature, and how we meet it',
  lead:
    'Most e-signature law does not name a technology. It names a handful of things that have to be true about a signature. Here is what those are, and where in SignerPro each one is handled.',
};

type Law = { name: string; body: string };

const LAWS: Law[] = [
  {
    name: 'The ESIGN Act (United States, federal)',
    body:
      'Says an electronic signature cannot be denied legal effect just because it is electronic, as long as both sides agreed to do business that way and the record can be kept and reproduced.',
  },
  {
    name: 'UETA (United States, state law)',
    body:
      'Adopted by nearly every state. It sets the same baseline as ESIGN at the state level: an electronic record and signature count, if the parties agreed to sign electronically.',
  },
  {
    name: 'eIDAS (European Union)',
    body:
      'Sets out tiers of electronic signature, from a simple signature up to a qualified electronic signature backed by a certified provider. A simple or advanced signature, of the kind SignerPro produces, is valid evidence; some document types in some member states call for the qualified tier.',
  },
];

type Pillar = { name: string; body: string; product: string; href: string };

// Each pillar maps to a shipped mechanism; see FEATURES.md §8 and PLATFORM_PLAN.md §1.
const PILLARS: Pillar[] = [
  {
    name: 'Intent to sign',
    body: 'The signer has to mean to sign, not stumble into it.',
    product:
      'A signer has to actively place their signature on the document; nothing is pre-filled or defaulted for them.',
    href: '/product/signing',
  },
  {
    name: 'Consent to do business electronically',
    body: 'The signer has to agree to sign electronically before they can sign.',
    product:
      'SignerPro withholds the document and its fields until the signer accepts an ESIGN and UETA consent screen, so consent happens before signing, not after.',
    href: '/product/signing',
  },
  {
    name: 'Association with the record',
    body: 'The signature has to be clearly tied to the one document it was applied to.',
    product:
      'Every signature is logged against the exact document version, with the signer’s IP address and user agent, and the finished file is hashed with SHA-256 so it can be checked against that record later.',
    href: '/product/audit-trail',
  },
  {
    name: 'Retention of the record',
    body: 'The signed record has to be kept and reproducible in the same form it was signed.',
    product:
      'The completed PDF is stored with its audit trail and audit certificate attached, and can be downloaded again in the form it was signed in for as long as your plan’s retention period.',
    href: '/security',
  },
];

const JURISDICTIONS: { name: string; body: string }[] = [
  {
    name: 'United States',
    body:
      'The ESIGN Act at the federal level, and UETA in nearly every state, both treat an electronic signature as legally equivalent to a wet-ink one when the parties consented to sign electronically. A small set of documents, like wills and certain court filings, are excluded from these laws and still need a handwritten signature.',
  },
  {
    name: 'European Union',
    body:
      'The eIDAS regulation recognizes three tiers: simple, advanced, and qualified electronic signatures. A simple or advanced signature is admissible as evidence across the EU. Certain regulated documents in some member states require the qualified tier, which needs a certified signing device and is outside what a standard e-signature platform provides.',
  },
  {
    name: 'United Kingdom',
    body:
      'The Electronic Communications Act 2000 and case law confirm that an electronic signature can satisfy a legal requirement for a signature, including on most contracts and deeds. Some property transactions and deeds have extra formality rules worth checking with counsel.',
  },
  {
    name: 'Canada',
    body:
      'Federal law (PIPEDA) and provincial electronic commerce acts, closely modeled on UETA, give electronic signatures the same standing as a handwritten one for most commercial agreements, provided the parties agreed to sign electronically.',
  },
  {
    name: 'Australia',
    body:
      'The Electronic Transactions Act 1999, mirrored in state legislation, permits an electronic signature to meet a legal signature requirement where the method reliably identifies the signer and shows their intent, and where the other party consents to the electronic method.',
  },
];

const FAQ: FaqItem[] = [
  {
    q: 'Is a SignerPro signature legally binding?',
    a: 'In most jurisdictions and for most contracts, yes, an electronic signature made through consent, a clear intent to sign, and a retained record is treated the same as a handwritten one. Some document types are excluded by law from electronic signing; check with your own counsel for those.',
  },
  {
    q: 'Is this page legal advice?',
    a: 'No. It explains the general legal framework and how our product is built against it. Whether a specific document or transaction can be signed electronically depends on your jurisdiction and document type, so ask a lawyer for anything that matters.',
  },
  {
    q: 'What if my document needs a qualified electronic signature under eIDAS?',
    a: 'SignerPro produces simple and advanced electronic signatures, which cover most commercial use. A small set of regulated documents in the EU require the qualified tier, which needs a certified signing device from a qualified trust service provider.',
  },
  {
    q: 'How do you prove consent happened?',
    a: 'The consent screen is a required step before a signer can see the fields or sign, and accepting it is written to the audit log with a timestamp, so the record shows consent came before the signature.',
  },
];

export default function LegalityPage() {
  return (
    <>
      <Hero
        eyebrow={HERO.eyebrow}
        title={HERO.title}
        lead={HERO.lead}
        actions={
          <CtaRow>
            <Cta href="/product/signing" size="lg">
              See the consent step
            </Cta>
            <Cta href="/security" variant="on-dark" size="lg">
              Read the security page
            </Cta>
          </CtaRow>
        }
      />

      <Section tone="canvas">
        <Container>
          <SectionHeader
            eyebrow="The laws"
            title="Three laws set most of the rules"
            lead="They differ in wording, but they agree on the same handful of ideas below."
          />
          <Grid columns={3}>
            {LAWS.map(law => (
              <Card key={law.name}>
                <Display level={3} size="sm" className="mb-2">
                  {law.name}
                </Display>
                <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{law.body}</p>
              </Card>
            ))}
          </Grid>
        </Container>
      </Section>

      <Section tone="alt">
        <Container>
          <SectionHeader
            eyebrow="What makes it enforceable"
            title="Four things a signature needs, and where we build each one"
          />
          <Grid columns={2}>
            {PILLARS.map(pillar => (
              <Card key={pillar.name}>
                <Display level={3} size="sm" className="mb-2">
                  {pillar.name}
                </Display>
                <p className="m-0 mb-3 text-mk-copy-sm text-mk-ink-muted">{pillar.body}</p>
                <p className="m-0 mb-3 text-mk-copy-sm text-mk-ink">{pillar.product}</p>
                <Cta href={pillar.href} variant="ghost">
                  See how it works
                </Cta>
              </Card>
            ))}
          </Grid>
        </Container>
      </Section>

      <Section tone="canvas">
        <Container>
          <SectionHeader
            eyebrow="By jurisdiction"
            title="A quick summary, region by region"
            lead="General information, not a legal opinion for your specific document."
          />
          <Grid columns={3}>
            {JURISDICTIONS.map(place => (
              <Card key={place.name}>
                <Display level={3} size="sm" className="mb-2">
                  {place.name}
                </Display>
                <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{place.body}</p>
              </Card>
            ))}
          </Grid>
          <p className="mt-mk-stack-lg mb-0 text-center text-mk-copy-xs text-mk-ink-subtle">
            This page gives general information about electronic signature law. It is not
            legal advice, and it does not cover every document type or jurisdiction. Talk to
            a lawyer before you decide how to sign something that matters.
          </p>
        </Container>
      </Section>

      <Faq items={FAQ} title="Legality questions people ask first" />

      <CtaBand
        title="See the consent and audit trail for yourself"
        lead="Every document goes through the same consent gate and leaves the same signed, hashed record."
        secondary={{ href: '/trust', label: 'Open the trust center' }}
      />
    </>
  );
}
