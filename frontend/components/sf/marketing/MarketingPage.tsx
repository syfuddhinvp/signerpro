/**
 * The public marketing page — rendered at `/` for a visitor with no session,
 * and always at `/product` so a signed-in user can still link to it.
 *
 * Two rules shape it:
 *
 *  1. Every claim on this page has to be something the product actually does.
 *     The feature copy names shipped surfaces (prepare, routing, the audit
 *     trail's per-signer link, signer payments, the shared template catalog,
 *     the embed landing and API keys) and nothing else.
 *  2. Pricing is not retyped here. The plan catalogue lives in the backend and
 *     is served publicly by `GET /api/billing/plans`, so the page renders that
 *     — the same rows the in-app plan picker shows. If the API is unreachable
 *     the section degrades to a link rather than inventing a price.
 *
 * It is a server component: no client state, no client JS. The responsive
 * rules live in one scoped `<style>` block because the app styles itself with
 * inline objects, which cannot express a media query.
 */
import Link from 'next/link';
import type { CSSProperties } from 'react';
import BrandMark from '@/components/sf/BrandMark';
import Icon, { type IconName } from '@/components/sf/Icon';
import { apiFetchPublic } from '@/lib/api/client';
import { toPlanChoices, type PlanChoice } from '@/lib/sf/adapters';
import type { PlanResponse } from '@/lib/api/types';
import { TEXT_MUTED, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '@/lib/sf/ui';

/* The marketing page is pre-authentication, so there is no tenant accent to
   read — it uses the product's own indigo, the token default. */
const ACCENT = '#4f46e5';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'pencil',
    title: 'Prepare once, reuse forever',
    body:
      'Drop signature, date, text and checkbox fields onto the PDF, assign each one to a recipient, then save the whole thing as a template your team sends again next week.',
  },
  {
    icon: 'contacts',
    title: 'Routing that matches how deals close',
    body:
      'Send to everyone at once, or in order, so the counter-signature only goes out once the customer has signed. Each recipient gets their own link and their own fields.',
  },
  {
    icon: 'card',
    title: 'Get paid at the signature',
    body:
      'Connect your own Stripe account and collect a deposit or the full fee inside the signing session, so the contract and the payment land in the same minute.',
  },
  {
    icon: 'shield',
    title: 'An audit trail that holds up',
    body:
      'Every view, field change and signature is timestamped against the signer who made it. Copy any signer’s link straight from the trail when someone says the email never arrived.',
  },
  {
    icon: 'documents',
    title: 'A shared form catalog',
    body:
      'Standard forms are published centrally and imported into your template library, so nobody is emailing around a stale copy of last year’s agreement.',
  },
  {
    icon: 'developer',
    title: 'Embed it or call it',
    body:
      'Mint an API key and drive signing from your own product, or drop the embed landing into a page and let customers start a signing session without leaving it.',
  },
];

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Upload', body: 'Bring a PDF, or start from a template your team already uses.' },
  { n: '2', title: 'Place fields', body: 'Assign every field to the recipient who has to fill it in.' },
  { n: '3', title: 'Send', body: 'Recipients sign in the browser — no account, no app to install.' },
  { n: '4', title: 'Close', body: 'The sealed PDF and its audit trail land back in your workspace.' },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Do the people I send to need an account?',
    a: 'No. A recipient gets a link, opens it in the browser, and signs. Accounts are only for the people on your side who prepare and send documents.',
  },
  {
    q: 'Can I use my own branding?',
    a: 'Yes, on the plans that include it: your logo and accent colour carry into the signing page and the emails your recipients receive.',
  },
  {
    q: 'How do payments work?',
    a: 'You connect your own Stripe account, so money moves from the signer to you directly. Your subscription to SignerPro is billed separately.',
  },
  {
    q: 'What happens to a document once it is signed?',
    a: 'It is sealed, stored with its audit trail, and downloadable as a PDF. Retention is set by your plan.',
  },
];

/** `GET /api/billing/plans` is public; a failure hides the grid, never fakes it. */
async function loadPlans(): Promise<PlanChoice[]> {
  const res = await apiFetchPublic<PlanResponse[]>('/api/billing/plans');
  if (!res.ok) return [];
  return toPlanChoices(res.data);
}

export default async function MarketingPage() {
  const plans = await loadPlans();

  const shell: CSSProperties = { background: 'hsl(var(--color-bg-surface))', color: 'hsl(var(--color-fg-default))' };
  const sectionTitle: CSSProperties = { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 10px' };
  const sectionLead: CSSProperties = { fontSize: '1rem', color: TEXT_MUTED, margin: '0 auto 40px', maxWidth: '58ch', lineHeight: 1.6 };

  return (
    <div style={shell}>
      <style>{CSS}</style>

      <header className="mk-nav">
        <Link href="/product" className="mk-brand" aria-label="SignerPro home">
          <BrandMark size={30} accent={ACCENT} />
          <span>SignerPro</span>
        </Link>
        <nav className="mk-navlinks" aria-label="Page sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          {plans.length > 0 ? <a href="#pricing">Pricing</a> : null}
          <a href="#faq">FAQ</a>
        </nav>
        <div className="mk-navcta">
          <Link href="/login" className="mk-btn mk-btn-ghost">Sign in</Link>
          <Link href="/register" className="mk-btn mk-btn-solid">Start free</Link>
        </div>
      </header>

      <main id="main">
        {/* ── hero ─────────────────────────────────────────────────────── */}
        <section className="mk-hero" data-sf-dark>
          <div className="mk-hero-copy">
            <p className="mk-eyebrow">E-signature, without the enterprise tax</p>
            <h1 className="mk-h1">Send it. Sign it. Get paid for it.</h1>
            <p className="mk-sub">
              SignerPro takes a contract from a PDF on your desktop to a sealed, audited, paid-for
              agreement — in one link, in the browser, with nothing for your customer to install.
            </p>
            <div className="mk-herocta">
              <Link href="/register" className="mk-btn mk-btn-solid mk-btn-lg">Start free</Link>
              <Link href="/login" className="mk-btn mk-btn-onDark mk-btn-lg">Sign in</Link>
            </div>
            <p className="mk-note">No card to try it. Paid plans start with a 14-day trial.</p>
          </div>
          <div className="mk-hero-art" aria-hidden="true">
            <div className="mk-card-float">
              <div className="mk-doc-head">
                <BrandMark size={22} accent={ACCENT} />
                <span>Master services agreement</span>
              </div>
              <div className="mk-doc-line" style={{ width: '92%' }} />
              <div className="mk-doc-line" style={{ width: '78%' }} />
              <div className="mk-doc-line" style={{ width: '85%' }} />
              <div className="mk-doc-field">Signature · Dana R.</div>
              <div className="mk-doc-line" style={{ width: '64%' }} />
              <div className="mk-doc-pay">
                <span>Deposit due at signing</span>
                <strong data-sf-num>$1,500.00</strong>
              </div>
            </div>
          </div>
        </section>

        {/* ── features ─────────────────────────────────────────────────── */}
        <section id="features" className="mk-section">
          <h2 style={sectionTitle}>Everything a signature actually needs around it</h2>
          <p style={sectionLead}>
            The signature is the easy part. What takes the week is the routing, the chasing, the
            payment and the paper trail — so that is what the product is built around.
          </p>
          <ul className="mk-grid mk-grid-3">
            {FEATURES.map(feature => (
              <li key={feature.title} className="mk-card">
                <span className="mk-ico" aria-hidden="true"><Icon name={feature.icon} size={18} /></span>
                <h3 className="mk-card-title">{feature.title}</h3>
                <p className="mk-card-body">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── how it works ─────────────────────────────────────────────── */}
        <section id="how" className="mk-section mk-section-alt">
          <h2 style={sectionTitle}>Four steps, start to sealed</h2>
          <p style={sectionLead}>The first document takes about five minutes. The second one takes thirty seconds.</p>
          <ol className="mk-grid mk-grid-4 mk-steps">
            {STEPS.map(step => (
              <li key={step.n} className="mk-step">
                <span className="mk-step-n" aria-hidden="true">{step.n}</span>
                <h3 className="mk-card-title">{step.title}</h3>
                <p className="mk-card-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── pricing (live catalogue) ─────────────────────────────────── */}
        {plans.length > 0 ? (
          <section id="pricing" className="mk-section">
            <h2 style={sectionTitle}>Priced per seat, not per signature</h2>
            <p style={sectionLead}>
              You pay for the people who send documents. The people who sign them never pay anything.
            </p>
            <ul className="mk-grid mk-grid-3">
              {plans.map((plan, index) => (
                <li key={plan.code} className={'mk-plan' + (index === 1 ? ' mk-plan-featured' : '')}>
                  <div className="mk-plan-head">
                    <h3 className="mk-plan-name">{plan.name}</h3>
                    {plan.tag ? <span className="mk-tag">{plan.tag}</span> : null}
                  </div>
                  <p className="mk-price" data-sf-num>
                    {plan.priceLabel}
                    <span className="mk-price-unit"> / mo</span>
                  </p>
                  <ul className="mk-plan-lines">
                    {plan.lines.map(line => (
                      <li key={line.k}>
                        <span>{line.k}</span>
                        <strong>{line.v}</strong>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/register?plan=${encodeURIComponent(plan.code)}`}
                    className={'mk-btn mk-btn-block ' + (index === 1 ? 'mk-btn-solid' : 'mk-btn-outline')}
                  >
                    Choose {plan.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ── faq ──────────────────────────────────────────────────────── */}
        <section id="faq" className="mk-section mk-section-alt">
          <h2 style={sectionTitle}>Questions people ask first</h2>
          <div className="mk-faq">
            {FAQ.map(item => (
              <details key={item.q} className="mk-faq-item">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── closing cta ──────────────────────────────────────────────── */}
        <section className="mk-cta" data-sf-dark>
          <h2 className="mk-cta-title">Send your first document today</h2>
          <p className="mk-cta-sub" style={{ color: TEXT_MUTED_ON_DARK }}>
            Create a workspace, upload a PDF, and have it signed before the end of the afternoon.
          </p>
          <Link href="/register" className="mk-btn mk-btn-solid mk-btn-lg">Start free</Link>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-brand mk-brand-quiet">
          <BrandMark size={24} accent={ACCENT} />
          <span>SignerPro</span>
        </div>
        <nav className="mk-footlinks" aria-label="Footer">
          <Link href="/login">Sign in</Link>
          <Link href="/register">Create an account</Link>
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
        </nav>
        <p className="mk-fineprint" style={{ color: TEXT_MUTED }}>
          © {new Date().getFullYear()} SignerPro
        </p>
      </footer>
    </div>
  );
}

/* Scoped to the `mk-` prefix: the app has no Tailwind preflight and styles
   itself inline, so the page's layout, hover and media rules live here. Colours
   come from `app/tokens.css`; the two dark bands use the dark-surface text
   tokens from `lib/sf/ui.ts` for contrast. */
const CSS = `
.mk-nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 24px;
  padding: 14px clamp(16px, 5vw, 56px); background: hsl(var(--color-bg-surface) / .92);
  backdrop-filter: blur(8px); border-bottom: 1px solid hsl(var(--color-border-subtle)); }
.mk-brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.0625rem;
  color: hsl(var(--color-fg-default)); text-decoration: none; }
.mk-brand:hover { color: hsl(var(--color-fg-default)); text-decoration: none; }
.mk-navlinks { display: flex; gap: 22px; margin-left: auto; }
.mk-navlinks a { color: ${TEXT_MUTED}; font-size: .9375rem; font-weight: 500; text-decoration: none; }
.mk-navlinks a:hover { color: hsl(var(--color-fg-default)); text-decoration: none; }
.mk-navcta { display: flex; gap: 10px; align-items: center; }

.mk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 18px; border-radius: var(--radius-sm, 8px); font-size: .9375rem; font-weight: 600;
  text-decoration: none; border: 1px solid transparent; transition: background var(--duration-fast, .15s) ease, color var(--duration-fast, .15s) ease; }
.mk-btn:hover { text-decoration: none; }
.mk-btn-lg { padding: 13px 24px; font-size: 1rem; }
.mk-btn-block { display: flex; width: 100%; margin-top: auto; }
.mk-btn-solid { background: hsl(var(--color-accent-solid)); color: hsl(var(--color-accent-on-solid)); }
.mk-btn-solid:hover { background: hsl(var(--color-accent-solid-hover)); color: hsl(var(--color-accent-on-solid)); }
.mk-btn-ghost { color: hsl(var(--color-fg-default)); }
.mk-btn-ghost:hover { background: hsl(var(--color-bg-muted)); color: hsl(var(--color-fg-default)); }
.mk-btn-outline { border-color: hsl(var(--color-border-default)); color: hsl(var(--color-fg-default)); background: hsl(var(--color-bg-surface)); }
.mk-btn-outline:hover { border-color: hsl(var(--color-accent-solid)); color: hsl(var(--color-accent-fg)); }
.mk-btn-onDark { border-color: hsl(var(--color-fg-inverse) / .4); color: ${TEXT_ON_DARK}; }
.mk-btn-onDark:hover { background: hsl(var(--color-fg-inverse) / .12); color: ${TEXT_ON_DARK}; }

.mk-hero { display: grid; grid-template-columns: 1.05fr .95fr; gap: 48px; align-items: center;
  padding: clamp(56px, 9vw, 104px) clamp(16px, 5vw, 56px);
  background: radial-gradient(1100px 520px at 12% -10%, hsl(var(--color-accent-solid) / .45), transparent 60%), hsl(var(--color-bg-inverse));
  color: ${TEXT_ON_DARK}; }
.mk-eyebrow { margin: 0 0 14px; font-size: .8125rem; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: hsl(var(--color-accent-muted)); }
.mk-h1 { margin: 0 0 18px; font-size: clamp(2.25rem, 1.4rem + 3.2vw, 3.5rem); line-height: 1.08;
  letter-spacing: -.03em; font-weight: 800; }
.mk-sub { margin: 0 0 28px; max-width: 54ch; font-size: 1.0625rem; line-height: 1.65; color: ${TEXT_MUTED_ON_DARK}; }
.mk-herocta { display: flex; flex-wrap: wrap; gap: 12px; }
.mk-note { margin: 18px 0 0; font-size: .875rem; color: ${TEXT_MUTED_ON_DARK}; }

.mk-hero-art { display: grid; place-items: center; }
.mk-card-float { width: min(400px, 100%); padding: 22px; border-radius: 16px;
  background: hsl(var(--color-bg-surface)); color: hsl(var(--color-fg-default));
  box-shadow: 0 30px 70px hsl(222 47% 4% / .45); }
.mk-doc-head { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: .9375rem; margin-bottom: 18px; }
.mk-doc-line { height: 9px; border-radius: 5px; background: hsl(var(--color-bg-muted)); margin-bottom: 11px; }
.mk-doc-field { margin: 16px 0; padding: 14px 12px; border-radius: 8px; font-size: .8125rem; font-weight: 600;
  color: hsl(var(--color-accent-fg)); background: hsl(var(--color-accent-subtle));
  border: 1px dashed hsl(var(--color-accent-solid)); }
.mk-doc-pay { display: flex; align-items: center; justify-content: space-between; margin-top: 18px;
  padding-top: 14px; border-top: 1px solid hsl(var(--color-border-subtle)); font-size: .875rem; color: ${TEXT_MUTED}; }
.mk-doc-pay strong { color: hsl(var(--color-fg-success)); font-size: 1.0625rem; }

.mk-section { padding: clamp(56px, 7vw, 92px) clamp(16px, 5vw, 56px); text-align: center; }
.mk-section-alt { background: hsl(var(--color-bg-subtle)); border-block: 1px solid hsl(var(--color-border-subtle)); }
.mk-grid { display: grid; gap: 20px; max-width: 1120px; margin: 0 auto; padding: 0; list-style: none; text-align: left; }
.mk-grid-3 { grid-template-columns: repeat(3, 1fr); }
.mk-grid-4 { grid-template-columns: repeat(4, 1fr); }

.mk-card { padding: 24px; border-radius: 14px; background: hsl(var(--color-bg-surface));
  border: 1px solid hsl(var(--color-border-subtle)); }
.mk-ico { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px;
  margin-bottom: 14px; color: hsl(var(--color-accent-fg)); background: hsl(var(--color-accent-subtle)); }
.mk-card-title { margin: 0 0 8px; font-size: 1.0625rem; font-weight: 700; letter-spacing: -.01em; }
.mk-card-body { margin: 0; font-size: .9375rem; line-height: 1.6; color: ${TEXT_MUTED}; }

.mk-steps { counter-reset: step; }
.mk-step { padding: 22px; border-radius: 14px; background: hsl(var(--color-bg-surface));
  border: 1px solid hsl(var(--color-border-subtle)); }
.mk-step-n { display: grid; place-items: center; width: 30px; height: 30px; margin-bottom: 14px;
  border-radius: 50%; font-size: .875rem; font-weight: 700;
  color: hsl(var(--color-accent-on-solid)); background: hsl(var(--color-accent-solid)); }

.mk-plan { display: flex; flex-direction: column; padding: 26px; border-radius: 16px;
  background: hsl(var(--color-bg-surface)); border: 1px solid hsl(var(--color-border-default)); }
.mk-plan-featured { border-color: hsl(var(--color-accent-solid)); box-shadow: 0 16px 40px hsl(var(--color-accent-solid) / .14); }
.mk-plan-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.mk-plan-name { margin: 0; font-size: 1.125rem; font-weight: 700; }
.mk-tag { padding: 3px 9px; border-radius: 999px; font-size: .75rem; font-weight: 600;
  color: hsl(var(--color-accent-fg)); background: hsl(var(--color-accent-subtle)); }
.mk-price { margin: 0 0 18px; font-size: 2rem; font-weight: 800; letter-spacing: -.02em; }
.mk-price-unit { font-size: .9375rem; font-weight: 600; color: ${TEXT_MUTED}; }
.mk-plan-lines { list-style: none; margin: 0 0 22px; padding: 0; display: grid; gap: 10px; }
.mk-plan-lines li { display: flex; justify-content: space-between; gap: 14px; font-size: .9375rem;
  padding-bottom: 10px; border-bottom: 1px solid hsl(var(--color-border-subtle)); color: ${TEXT_MUTED}; }
.mk-plan-lines strong { color: hsl(var(--color-fg-default)); text-align: right; }

.mk-faq { max-width: 780px; margin: 0 auto; text-align: left; display: grid; gap: 12px; }
.mk-faq-item { padding: 18px 20px; border-radius: 12px; background: hsl(var(--color-bg-surface));
  border: 1px solid hsl(var(--color-border-subtle)); }
.mk-faq-item summary { cursor: pointer; font-weight: 600; font-size: 1rem; list-style-position: outside; }
.mk-faq-item p { margin: 12px 0 0; font-size: .9375rem; line-height: 1.6; color: ${TEXT_MUTED}; }

.mk-cta { padding: clamp(56px, 7vw, 88px) clamp(16px, 5vw, 56px); text-align: center;
  background: hsl(var(--color-bg-inverse)); color: ${TEXT_ON_DARK}; }
.mk-cta-title { margin: 0 0 12px; font-size: clamp(1.75rem, 1.2rem + 1.8vw, 2.5rem); font-weight: 800; letter-spacing: -.02em; }
.mk-cta-sub { margin: 0 auto 26px; max-width: 52ch; font-size: 1rem; line-height: 1.6; }

.mk-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 18px;
  padding: 26px clamp(16px, 5vw, 56px); border-top: 1px solid hsl(var(--color-border-subtle)); }
.mk-brand-quiet { font-size: .9375rem; }
.mk-footlinks { display: flex; flex-wrap: wrap; gap: 20px; margin-inline: auto; }
.mk-footlinks a { color: ${TEXT_MUTED}; font-size: .875rem; text-decoration: none; }
.mk-footlinks a:hover { color: hsl(var(--color-fg-default)); text-decoration: none; }
.mk-fineprint { margin: 0; font-size: .8125rem; }

@media (max-width: 960px) {
  .mk-hero { grid-template-columns: 1fr; }
  .mk-hero-art { order: -1; }
  .mk-grid-3, .mk-grid-4 { grid-template-columns: repeat(2, 1fr); }
  .mk-navlinks { display: none; }
}
@media (max-width: 620px) {
  .mk-grid-3, .mk-grid-4 { grid-template-columns: 1fr; }
  .mk-navcta .mk-btn-ghost { display: none; }
  .mk-footlinks { margin-inline: 0; }
}
`;
