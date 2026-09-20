# SignerPro marketing site and design system plan

How SignerPro takes share from DocuSign and the mid-market pack with its marketing site,
pricing story and a design system that can carry both the product and the brand.

Evidence lives in `MARKETING_RESEARCH.md`. Product facts cite `FEATURES.md`, the billing
catalogue in migration `b7f2c9d41a08_platform_foundations.py`, and the current page at
`frontend/components/sf/marketing/MarketingPage.tsx`.

**Status: phases 0 to 2 built.** The token layer, the component kit and 29 marketing
routes are in the repo and verified. What is *not* built is the proof track (section 7),
the interactive demo, `/open` and `/roadmap` (tier 3), and the pricing restructure in
section 3, which is a billing change rather than a marketing one. Section 8 carries the
per-phase state.

---

## 1. Where SignerPro stands today

### What the current page gets right

- Every claim maps to a shipped surface. Keep that rule; it is rarer than it sounds and it is the basis for a trust-led brand.
- Pricing is read live from `GET /api/billing/plans`, never retyped.
- Server component, no client JS, dark hero using the existing token layer, focus rings, skip link.
- The hero already hints at the wedge: a signature field and "Deposit due at signing $1,500.00" in one card.

### What holds it back

| Gap | Evidence | Cost |
|---|---|---|
| One page, one URL | Only `/product`. Competitors run 8 to 80 industry, comparison and template pages each. | Zero organic surface area. Nobody searching "DocuSign alternative" or "lease agreement e-signature" can find SignerPro. |
| No proof | No logos, no rating, no numbers, no badges, no screenshots of the real UI. | Baymard: 20% of SaaS sites never show the UI. Julian Shapiro's formula needs social proof directly after the hero. |
| No trust surface | No `/security`, `/trust`, `/legality`. The public `/verify/{id}` page exists but is not marketed. | Enterprise buyers scan for compliance before reading copy. |
| Pricing copy contradicts the catalogue | Page says "Priced per seat, not per signature". The catalogue is Free $0, Growth $49 flat with 10 users and 250 docs a month, Enterprise $499 flat. That is per workspace with caps, not per seat. | A visitor who reads both leaves confused. |
| App-scale tokens on a marketing page | Body token is 0.78rem, display 1.875rem, spacing tops out at 30px. The page hard-codes its own 3.5rem hero and 56px sections in a CSS string because the tokens cannot express them. | No shared vocabulary; every new marketing page will re-invent sizes. |
| Styling in a template string | 200 lines of CSS inside a JS string, `ACCENT = '#4f46e5'` hard-coded, colours pulled from `lib/sf/ui.ts` constants. | Cannot be linted, themed, or reused across the 30-plus pages this plan needs. |
| Generic brand | Indigo #4f46e5 on white with Geist. DocuSign, Stripe, Linear, Clerk, Xodo Sign all sit on the same hue. | Nothing to remember. |

---

## 2. Positioning: where to attack the leader

DocuSign is not beatable on enterprise breadth, integration count, or AI platform marketing.
It is beatable on the four things its own customers complain about most: price, envelope
quotas, surprise fees, and gating SSO and payments behind $45-plus seats and sales calls.
The mid-market pack attacks the same wounds but each hides a cap of its own (research
section 1.2), and none of them owns payments or verifiability.

### The wedge

SignerPro already ships four things that are rare together:

1. **Payment at the signature.** Stripe Connect per tenant, split allocations, refunds, multi-currency (`FEATURES.md` section 7). Dropbox Sign has none. DocuSign gates it at $45/user. PandaDoc at $49/user.
2. **A verifiable record.** Public `/verify/{id}`, PAdES signing, SHA-256 hashes, audit certificate appended to the PDF (section 8). Nobody markets third-party verification.
3. **Everything for builders on self-serve.** API keys with scopes, webhooks with replay, sandbox, embedded sessions with `frame-ancestors` control, white-label branding per tenant (sections 11, 14, 15). Competitors gate API to enterprise or meter it.
4. **Enterprise identity on every plan.** SAML SSO, SCIM, passkeys, MFA (section 1). DocuSign, signNow, PandaDoc all make SSO a sales conversation.

### Positioning statement

> SignerPro is e-signature for teams that need the contract, the payment and the proof to land together. Send in the browser, get paid at the signature, and hand anyone a link that proves the document is real. No envelope quota, no per-signature fee, no feature held back for a sales call.

### Three messages, in priority order

| Message | Who it beats | Where it lives |
|---|---|---|
| **Get paid at the signature** | Dropbox Sign (absent), DocuSign and PandaDoc (top tier only) | Hero, `/product/payments`, real estate and services verticals |
| **Nothing held back** (unlimited envelopes, API, SSO, branding on every paid plan, published prices) | DocuSign quotas, signNow Site License, PandaDoc add-ons, Adobe API gating | `/pricing`, every `/vs` page, closing CTA band |
| **Prove it to anyone** (public verify link, audit certificate, PAdES) | Everyone; unclaimed | `/trust`, `/product/audit-trail`, footer of every signed PDF and email |

Secondary: "Beautiful to sign" (show the recipient's phone flow; nobody does) and "Built for
the people who ship" (code on the developer page, MCP server, changelog).

### What not to do

- Do not lead with "AI-powered". DocuSign, Adobe, PandaDoc and Zoho all do; it is table stakes noise at this stage and SignerPro has no shipped AI surface to back it.
- Do not claim SOC 2, HIPAA or ISO until held. Say what is true: encryption, tenant isolation, audit logs, PAdES, ESIGN and UETA disclosure gate, and publish a compliance roadmap with dates.
- Do not fight on integration count. Route integration demand through the API, webhooks and Zapier, and name the handful that exist.

---

## 3. Pricing story

The catalogue works as a starting position but its shape undermines the "nothing held back"
message and contradicts the page copy. Recommendation, grounded in the research matrix:

| Plan | Price | Senders | Envelopes | Included | Why |
|---|---|---|---|---|---|
| Free | $0 | 2 | 5 a month | signing, templates, audit trail, verify page, API sandbox | Matches Documenso, Zoho, Xodo. Beats Dropbox (3) and SignWell (3). |
| Team | $19 per sender per month, $15 annual | any | unlimited | branding, payments, API, webhooks, SSO, SCIM, embed | Undercuts DocuSign Standard ($30) with Business Pro features ($45). Above signNow and BoldSign, justified by payments and SSO, which they gate. |
| Business | $99 per workspace per month, $79 annual | unlimited | unlimited | Team plus white-label embed, data retention controls, priority support | Occupies the "self-serve white-label under $100" gap. Documenso charges $250. |
| Enterprise | from $499 | unlimited | unlimited | dedicated SMTP and SMS gateways, DLP, custom retention, SLA, invoicing | Keeps the existing tier. |
| API usage | published: first 50 signed documents a month included on Team, then $0.30 each | | | | Between DocuSeal ($0.20) and BoldSign ($0.75). Published, so no "contact sales" wall. |

Rules for the pricing page, all taken from the complaints list:

- Publish every number, including overage and SMS pricing. No "contact sales" as the only path to any feature except Enterprise.
- Toggle defaults to annual, shows the saving on the toggle. Middle tier carries the "Most teams" badge on a dark card.
- Comparison matrix names every feature, links each to its product page, has tooltips for jargon.
- FAQ answers the four questions competitors dodge: what counts as an envelope, what happens when I cancel, do signers pay, where is my data stored. Marked up with `FAQPage` JSON-LD.
- A savings calculator against DocuSign (Xodo Sign and BoldSign both convert with one).

Migration notes for the catalogue live in `BILLING_PLAN.md` territory; plan codes stay
`free`, `growth`, `enterprise` with `growth` renamed and a new `business` inserted. The
marketing page continues to render from the API, so the copy line "Priced per seat" must be
generated from the plan's `seat_price_cents` rather than typed.

---

## 4. Site architecture

Tiered by leverage. Tier 1 is what a serious SaaS is expected to have. Tier 2 is where
organic acquisition comes from. Tier 3 is where the brand pulls ahead.

### Tier 1: the core set

| URL | Purpose | Notes |
|---|---|---|
| `/` and `/product` | Home | Blueprint in section 5 |
| `/pricing` | Full pricing, matrix, calculator, FAQ | Section 3 |
| `/product/payments` | Get paid at the signature | Stripe Connect flow, split modes, refunds, currency |
| `/product/routing` | Sequential and parallel routing, roles, reassignment | |
| `/product/templates` | Templates and the shared catalogue | |
| `/product/audit-trail` | Audit log, certificate, PAdES, `/verify` | Embed a live sample verify page |
| `/product/branding` | Per-tenant themes, signing page, emails | |
| `/product/signing` | The recipient experience, phone first | The unclaimed hero |
| `/developers` | API, webhooks, embed, sandbox, SDK badges, code on the page | Follow BoldSign and DocuSeal: tabbed cURL, JS, Python snippets, "Get API key" CTA |
| `/security` | Controls, encryption, isolation, disclosure gate, DLP, retention, pen-test cadence | Honest badge row: ESIGN, UETA, eIDAS SES, GDPR. Roadmap for SOC 2. |
| `/trust` | Trust center: documents, subprocessors, status, sample audit certificate PDF | Can be a page now, a Vanta or Drata embed later |
| `/customers` | Case studies with one metric each | Seed with design partners in real estate and mortgage |
| `/changelog` | Weekly, versioned | DocuSeal cadence |
| `/about`, `/contact`, `/legal/*` | | |

### Tier 2: organic acquisition

| Pattern | First pages | Data source |
|---|---|---|
| `/vs/<competitor>` | docusign, pandadoc, dropbox-sign, signnow, signwell, boldsign, documenso | Honest matrix; concede what they do better. Include the challenger-vs-challenger pages nobody has. |
| `/alternatives/<competitor>` | docusign, adobe-sign, dropbox-sign | Ranked list including competitors, SignerPro placed honestly |
| `/templates/<type>` | nda, lease-agreement, purchase-agreement, offer-letter, contractor-agreement, mortgage-disclosure, listing-agreement, service-agreement | Back each with a real template from the shared catalogue (`FEATURES.md` section 3) and a "Sign this now" flow. This is what makes them not thin. |
| `/solutions/<vertical>` | real-estate, mortgage, property-management, professional-services, hr, legal | Real estate and mortgage first: that is the product's origin and the vertical PandaDoc, SignWell and signNow all fight over |
| `/integrations/<app>` | stripe, zapier, webhooks, salesforce (when shipped) | Only pages for things that exist |
| `/legality/<country>` | us, eu, uk, ca, au | ESIGN, UETA, eIDAS specifics, links to `/verify` |
| `/tools/sign-pdf`, `/tools/signature-maker` | Free tools that seed the Free plan | SignWell and Adobe convert on these |

Every page in this tier gets `SoftwareApplication`, `FAQPage` and `BreadcrumbList` JSON-LD
and lives in a footer "Compare", "Templates", "Solutions" block.

### Tier 3: brand pull

- `/open`: live counters from the platform (documents completed, payments collected, verify checks run), Documenso-style. The operator control plane already computes these (`FEATURES.md` section 18).
- `/roadmap`: public, with voting. Nobody in the category has one.
- `/developers/mcp`: an MCP server page once one exists. signNow, SignWell and DocuSeal already ship them.
- Interactive demo of the signing flow on the home page (Navattic-style; +12% over video).

---

## 5. Home page blueprint

Order follows the research skeleton: nav, hero, proof, objection blocks, demo, pricing,
trust, FAQ, closing band. Copy is at a grade 6 reading level on purpose.

1. **Nav** (64px). Product, Solutions, Pricing, Developers, Resources. "Sign in" ghost, "Start free" solid. Sticky, blurred surface.
2. **Hero**, dark band. Eyebrow: "E-signature with payment and proof built in". H1 options, pick by test:
   - "Send it. Sign it. Get paid for it." (current, keep as control)
   - "The contract, the payment and the proof, in one link."
   - "Sign in the browser. Pay at the signature. Prove it to anyone."
   Sub: "Upload a PDF, place fields, send. Your customer signs and pays on their phone. You get a sealed PDF and a link anyone can verify." CTAs: "Start free" and "See the signer's view". Micro-line: "No card. Every feature on every paid plan." Art: the real signing page on a phone frame beside the sender's audit trail, both live screenshots, not illustrations.
3. **Proof strip**. One logo row (design partners), one rating, one sentence from the audit trail: "N documents sealed, N verified this month" from `/open`. Never more than three proof chips near the CTA.
4. **Objection blocks**, four, each header plus paragraph plus UI screenshot:
   - "They sign, they pay, done." (payments)
   - "Route it the way the deal closes." (sequential and parallel)
   - "Hand anyone the proof." (verify link, certificate)
   - "Nothing held back." (API, SSO, branding, unlimited envelopes)
5. **Interactive demo**: the recipient flow, five to eight steps, ungated.
6. **Testimonial with a metric.**
7. **Pricing teaser**: three cards from the API, annual default, link to `/pricing`.
8. **Trust row**: ESIGN, UETA, eIDAS, GDPR, PAdES, plus "See how we secure documents" to `/security`.
9. **FAQ**, five items with `FAQPage` schema.
10. **Closing band**: "Send your first document today." Single CTA. No exit popup.
11. **Footer** with Compare, Templates, Solutions, Developers, Trust columns.

Each `/product/*` page follows the same order with the hero art swapped for that feature's
screenshot and a two-item proof strip.

---

## 6. Design system rethink

### 6.1 Diagnosis

The token layer in `frontend/app/tokens.css` is a good semantic app layer: HSL triplets,
WCAG-checked foreground tokens, a complete dark set, motion and stacking tokens. It has two
structural problems for marketing.

- There is no primitive layer. Semantic tokens carry literal HSL values, so a brand hue change means editing 30 lines and the dark block by hand.
- The scale is app-sized. Body 0.78rem, display 1.875rem, spacing to 30px, radius to 16px. A marketing page needs 44 to 80px display type, 96 to 192px section rhythm and pill CTAs. The current page proves it by hard-coding all of them.

### 6.2 Three-layer architecture

```
primitives (--p-*)        raw ladders, never used in components
   ├── app semantic (--color-*, --text-*, --space-*)   existing tokens.css, unchanged API
   └── marketing semantic (--mk-*)                      new marketing-tokens.css
```

Primitives: gray ladder 50 to 950, brand ladder 50 to 950, one accent ladder for money and
success, radius, space and type ramps. Both semantic layers alias into them. Tailwind keeps
reading the semantic layers only.

### 6.3 Brand direction

The hue problem is real: indigo is the most crowded colour in the category. Two options.

- **Option A, evolve (recommended for this quarter).** Keep indigo in-app to avoid touching 1,100 inline styles. Give marketing its own atmosphere: a warm paper canvas, near-black ink, indigo as the single action colour, and a "sealed" green reserved for paid and verified states. The distinctiveness comes from typography and imagery, not hue.
- **Option B, rebrand.** Move the whole product to an owned hue after the Tailwind migration. Candidates that are free in the category: deep ink blue-black with a tangerine action colour, or ink with a warm brass. Decide after option A has shipped and tested.

Typography is where SignerPro can stand apart at low cost. Every competitor uses a grotesk.
A document-signing product has a natural reason to pair Geist for UI with a display face
that recalls ink and paper. Recommendation: a free variable serif for marketing headlines
only, such as Instrument Serif or Fraunces, at weight 400 to 500 with tight tracking, on
top of Geist for everything else. Two families, four files, inside the performance budget.

Imagery rule: real UI only, with the recipient's phone flow as the recurring motif.
Motion: entrance fades and one hero interaction, all behind `prefers-reduced-motion`.

### 6.4 Marketing token layer

Proposed `frontend/app/marketing-tokens.css`, scoped to `[data-surface="marketing"]` so it
never leaks into the app.

```css
[data-surface="marketing"] {
  /* type: fluid for display only, discrete rem for copy */
  --mk-display-xl: clamp(2.75rem, 1.9rem + 3.6vw, 5rem);      /* 44 to 80px */
  --mk-display-lg: clamp(2.25rem, 1.6rem + 2.7vw, 3.5rem);    /* 36 to 56px */
  --mk-display-md: clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem);    /* 28 to 40px */
  --mk-display-sm: clamp(1.375rem, 1.2rem + 0.8vw, 1.75rem);  /* 22 to 28px */
  --mk-tracking-xl: -0.04em; --mk-tracking-lg: -0.03em; --mk-tracking-md: -0.02em;
  --mk-lh-display: 1.05; --mk-lh-copy: 1.55;
  --mk-copy-xl: 1.375rem; --mk-copy-lg: 1.125rem; --mk-copy-md: 1rem; --mk-copy-sm: .9375rem;
  --mk-eyebrow: .8125rem; --mk-eyebrow-tracking: .08em;
  --mk-font-display: var(--font-display), var(--font-sans);

  /* rhythm */
  --mk-space-section: clamp(4rem, 3rem + 4vw, 8rem);   /* 64 to 128px */
  --mk-space-band: clamp(6rem, 4rem + 6vw, 12rem);     /* hero and footer */
  --mk-space-stack: 1.5rem; --mk-space-stack-lg: 2.5rem;
  --mk-container: 1200px; --mk-container-wide: 1400px; --mk-gutter: clamp(16px, 5vw, 56px);

  /* shape */
  --mk-radius-cta: 999px; --mk-radius-card: 16px; --mk-radius-shot: 20px;
  --mk-cta-height: 44px;

  /* surfaces */
  --mk-canvas: var(--p-paper-50);            /* warm paper, not #fff */
  --mk-canvas-alt: var(--p-paper-100);
  --mk-ink: var(--p-gray-950);
  --mk-ink-muted: var(--p-gray-600);         /* must clear 4.5:1 on paper */
  --mk-band-dark: var(--p-gray-950);
  --mk-band-dark-raised: var(--p-gray-900);
  --mk-hairline-on-dark: hsl(0 0% 100% / .08);
  --mk-action: var(--color-accent-solid);
  --mk-sealed: var(--color-highlight-solid);  /* paid, verified */
  --mk-glow: radial-gradient(1100px 520px at 12% -10%, hsl(var(--color-accent-solid) / .35), transparent 60%);

  /* elevation on marketing only */
  --mk-shadow-shot: 0 30px 70px hsl(222 47% 4% / .35);
  --mk-shadow-card: 0 1px 2px hsl(222 47% 11% / .06), 0 12px 32px -12px hsl(222 47% 11% / .18);
}
```

Tailwind gets a `marketing` preset that maps `text-mk-display-xl`, `py-mk-section`,
`rounded-mk-cta` and friends onto these variables, so marketing pages are written in
utilities like the app will be after its migration.

### 6.5 Component kit

A `components/marketing/` kit replaces the CSS string. Each component is a server component
with one job:

`Nav`, `Hero`, `ProofStrip`, `LogoRow`, `FeatureBlock` (header, body, screenshot, reverse),
`StepList`, `PricingCards` (reads the API), `PlanMatrix`, `SavingsCalculator` (client),
`TrustRow`, `Faq` (emits `FAQPage` JSON-LD), `CtaBand`, `Footer`, `CompareTable`,
`TemplateCard`, `CodeTabs` (for `/developers`), `PhoneFrame` and `BrowserFrame` for shots.

Screenshots are generated from the real app by a Playwright script in `scripts/` against
seeded demo data, so they never drift from the product.

### 6.6 Quality bars

- WCAG 2.2 AA: 4.5:1 body, 3:1 display, 24px targets, 44px CTAs, focus visible on dark bands (already handled by `[data-sf-dark]`), sticky nav must not obscure focus, reduced motion honoured.
- Core Web Vitals p75 mobile: LCP 2.0s, INP 150ms, CLS 0.05. Hero screenshot preloaded as AVIF, fonts self-hosted with `size-adjust`, third-party scripts deferred, no analytics before interaction.
- Budget: JS under 150KB gzipped per landing page, two font families, four font files.
- Lighthouse accessibility 100 and axe zero critical in CI on every marketing route.

---

## 7. Proof strategy

Proof is the thin spot and it cannot be designed into existence. A parallel track:

1. **Design partners.** Five real estate or mortgage teams on Business free for six months in exchange for a logo and one metric each. Seed the logo row and `/customers`.
2. **Live numbers.** Ship `/open` from operator metrics so the proof strip is honest and self-updating.
3. **Review profiles.** Create G2 and Capterra listings now; every competitor's homepage leans on a dated badge.
4. **Compliance roadmap.** Publish SOC 2 Type 1 target date on `/security`. Say "in progress", never "compliant", until the letter exists.
5. **Sample artifacts.** A downloadable sample sealed PDF with its audit certificate, and a live `/verify` link on `/trust`. This is the proof only SignerPro can offer today.

---

## 8. Build order

| Phase | State | Deliverables |
|---|---|---|
| 0. Foundations | **Built** | `app/primitives.css`, `app/marketing-tokens.css`, the Tailwind `mk-` scale, `components/marketing/` (15 components plus a README contract), `scripts/marketing-screenshots.mjs`, and the per-seat copy now derived from the catalogue in `lib/marketing/pricing.ts` |
| 1. Core set | **Built** | `/pricing` with plan matrix and FAQ schema, six `/product/*` pages, `/developers` with code tabs, `/security`, `/trust`, `/legality`, `/changelog`, `sitemap.xml`, `robots.txt` |
| 2. Acquisition | **Built, partial** | Five `/vs`, three `/alternatives`, eight `/templates`, six `/solutions`. Not built: `/tools/*` free tools and `/integrations/*` |
| 3. Pull | Not started | `/open`, `/roadmap`, interactive signer demo, `/customers`. Blocked on the proof track in section 7, which is a business task rather than a build task |
| 4. Brand decision | Not started | Evaluate option B against test data after the Tailwind migration |

### What still needs a human

- **Real screenshots.** Every product image is a framed placeholder. Run `scripts/marketing-screenshots.mjs` against a seeded demo workspace and the frames fill with no layout shift.
- **`TODO` markers.** `/trust` has placeholder subprocessors and `/security` has no SOC 2 target date, both deliberately marked rather than invented. Search for `TODO(ops-team)` and `TODO(compliance-team)`.
- **`NEXT_PUBLIC_SITE_URL`.** The sitemap serves empty without it rather than guessing an origin.
- **Proof.** `ProofStrip` renders nothing until there are real logos and numbers to put in it.

### Metrics

| Metric | Baseline to establish | Target after phase 3 |
|---|---|---|
| Home visitor to signup | unknown | 5% (SaaS median 3.8%) |
| Pricing page to signup or contact | unknown | 7% |
| Organic landing sessions from Tier 2 pages | 0 | 40% of marketing sessions |
| Free to paid conversion | from billing | 4% at 30 days |
| CWV pass rate, mobile p75 | unknown | 100% of marketing routes |

---

## 9. Risks and honesty constraints

- **Claims outrun the product.** The existing rule stands: nothing on any marketing page that a user cannot do today. Comparison pages concede what competitors do better.
- **Pricing change churn.** Renaming Growth and inserting Business touches entitlements and proration in `billing_service.py`. Sequence it with `BILLING_PLAN.md` and grandfather existing subscriptions.
- **Thin programmatic pages.** Ship fewer template and vertical pages with a working flow each rather than many generic ones. signNow's 85k form pages are the anti-pattern.
- **Rebrand appetite.** Option B is a real cost while 1,100 inline styles remain. Do not start it before the Tailwind migration.
- **Payments as a hero claim** depends on Stripe Connect being available in the buyer's country. The payments page must list supported countries.
