# E-signature marketing research

Competitive teardown of 13 e-signature marketing sites plus B2B SaaS marketing-site
design-system and conversion research. Fetched live 2026-09-20. Companion to
`MARKETING_PLAN.md`, which turns this into decisions.

Caveats: PandaDoc blocks non-browser fetches (429), so its hero copy is unverified and its
prices come from third-party guides. OpenSign and Zoho prices are client-rendered and were
cross-checked against 2026 third-party sources. Palette hexes were pulled from live CSS by
frequency count; eyeball before reuse.

---

## 1. Competitor matrix

### 1.1 Positioning and hero

| Vendor | H1 (verbatim) | Primary CTA | Offer |
|---|---|---|---|
| DocuSign | "AI-powered agreement management" (home); "What is an electronic signature?" (eSignature page) | "Explore Docusign IAM" / "Try for Free" | Free trial; demo sales-only |
| Adobe Acrobat Sign | "Do business faster with eSign features from Acrobat." | "Free trial" (price in hero: US$28.98/mo) | 7-day trial |
| Dropbox Sign | "Simplify eSignatures for every team" | "Start a 30-day free trial" + "Get a demo" | 30-day trial, free plan (3 req/mo) |
| PandaDoc | (blocked) "360-degree agreement management" | "Request a demo" + 14-day trial | Free eSign 5 docs/mo |
| signNow | "Electronic signature for your entire organization" | "Try for free" (upload widget in hero) | 7-day trial, no card |
| SignWell | "Business-Grade eSignatures Without the Enterprise Overhead" | "Sign up with Google" | Free plan 3 docs/mo |
| Jotform Sign | "Free E-signature Software" | "Send my document for signature" (upload widget) | Free forever 10 docs/mo |
| Documenso | "Enterprise-Grade E-Signatures. For Everyone." | "Get Started" / "Check out the Platform Plan" | Free 5 docs/mo, self-host |
| OpenSign | "Seal the Deal, Openly." | "Get Started" / "Star On Github" | Free unlimited |
| BoldSign | "Premium E-Signatures Perfectly Priced" | "View plan" / "Start free trial" | 30-day trial, free 25 env/mo |
| Xodo Sign | "Faster Signatures. Flexible Integration. Fixed Pricing." | "Start for Free" (email capture) + "Calculate Savings" | Free 5 docs/mo |
| DocuSeal | "Document Signing for Everyone" | "Create free account" / "Host it yourself" | Free forever, on-prem free |
| Zoho Sign | "Sign, Paperless." | "Get Started Now" / "Contact Sales" | 14-day trial, free 5 env/mo |

### 1.2 Pricing and the hidden cap

| Vendor | Entry paid | Mid tier | Model | Hidden cap / trap | Gated to top tier |
|---|---|---|---|---|---|
| DocuSign | $11/mo Personal (5 env/mo) | $30/user Standard, $45 Business Pro | per user | 100 envelopes/user/year; SMS $0.36, IDV $2.40; 10-20% price rise Jan 2025 | SSO, HIPAA BAA, conditional routing, payments (Business Pro+) |
| Adobe | $16.99/licence | $23.99 Pro (bulk send, branding) | per licence | 150 transactions/user/year, not on pricing page; cancel fee = half of remaining year | API enterprise-only |
| Dropbox Sign | $15/mo Essentials (1 user) | $25/user Standard (2-user min) | per user, unlimited docs | Templates capped 5/15; API metered $75 for 50 requests | Unlimited templates |
| PandaDoc | $19/user Starter | $49/user Business | per seat, unlimited docs | 10 add-ons: API, Salesforce, bulk, HIPAA, QES, notary, CPQ | API, SSO |
| signNow | $8/user Business | $15 Premium, $30 Enterprise | per user | 100 invites/user/year, $1.50 overage; pricing on an unindexable JS app | API, SSO, HIPAA (Site License) |
| SignWell | $10/mo Light (1 sender) | $30/mo Business (3 senders) | per sender, unlimited docs | Template caps, SMS credits | 50+ seats |
| Jotform | $39/mo Bronze (100 docs) | $49 Silver, $129 Gold | single user, envelope caps | Multi-user is Enterprise only; 5MB file cap | HIPAA Gold+, SSO |
| Documenso | $25/mo Individual | $40 Teams (5 users, +$8) | per seat + $250 flat Platform | none published | white-label = Platform |
| OpenSign | $9.99/mo | $19.99/user Teams | credits | API tokens gated even on self-host | |
| BoldSign | $5/user Growth | $15/user Business (unlimited env, SSO, HIPAA) | per user + $0.75/envelope API | none | |
| Xodo Sign | $10/mo Basic | $16 Professional | per user, unlimited docs | API is a separate $50/mo plan | |
| DocuSeal | $20/user Pro | | per seat + $0.20/doc API | $0.20/doc even on-prem | |
| Zoho Sign | $10/user Standard (25 env) | $16 Pro unlimited, $22 Enterprise | per user | | API, bulk, QES at Enterprise |

Every vendor hides a cap somewhere. Only BoldSign and Documenso publish a fully transparent
price with no metering surprise, and neither includes signer payments.

### 1.3 Visual design

| Vendor | Brand hue | Canvas | Display face | Body face | Notes |
|---|---|---|---|---|---|
| DocuSign | #4C00FF purple, #130032 ink | white, #F8F3F0 warm | DSIndigo (custom) | DSIndigo | screenshots + flat illustrations, static hero |
| Adobe | Spectrum blue (~#3B63FB), red #EB1000 | white | Adobe Clean | Adobe Clean | tabbed feature carousel |
| Dropbox Sign | #0061FE royal blue, #1E1919 ink | #F7F5F2 warm | Sharp Grotesk | Atlas Grotesk | Webflow, minimal motion |
| PandaDoc | green ~#47B972 | white / navy | (unverified) | | mascot |
| signNow | #0777cf blue | #f9f9f9 | Graphik | Inter / Open Sans | very long page, illustrations |
| SignWell | #358792 teal, #fbbc05 yellow | white, #232D2F footer | Proxima Nova | Proxima Nova | real screenshots, no motion |
| Jotform | #0a1551 navy, orange CTA | #f3f3fe lavender | Circular | Circular | "It's Free!" everywhere |
| Documenso | #5cb31e green | white, dark via prefers-color-scheme | Inter Display | Inter | Framer Motion, "Beautiful" |
| OpenSign | #263238 slate, #116dff | dark hero photo | Syne | Questrial | Wix build |
| BoldSign | #001f54 navy, #ef0a0a red | white | Poppins | Inter | Elementor, Prism code tabs on home |
| Xodo Sign | #0206a8 indigo, #00e2ea cyan | white | Aktiv Grotesk | Roboto | savings calculator |
| DocuSeal | yellow ~#fabd22 accent | warm #f9f7f5 | system-ui | system-ui | daisyUI, code tabs on home |
| Zoho Sign | #f7b21b yellow, #2148aa | white | Zoho Puvi | Puvi | |

Observation: DocuSign, Stripe, Linear, Clerk, Xodo and SignerPro's current #4f46e5 are all
indigo/purple. Blue-on-white covers signNow, Jotform, Dropbox, Adobe, Zoho. Green is taken
by PandaDoc and Documenso. Warm teal (SignWell) and yellow (DocuSeal) are the only outliers.
Grotesk sans is universal; no vendor uses a serif or an editorial display face.

### 1.4 Secondary page inventory

| Page type | Who has it well | Who lacks it |
|---|---|---|
| Industry pages | DocuSign, Adobe, PandaDoc, signNow (8), SignWell (11) | Dropbox Sign, all open-source players |
| /vs or /alternatives | signNow (80+ pages, triangulated "X vs DocuSign vs signNow"), SignWell (root slugs), BoldSign, Xodo, PandaDoc, Jotform (dated listicles under product slug) | Adobe (PDF only), Documenso, OpenSign |
| Templates library | signNow (85k pages), Jotform (1,100), PandaDoc hubs, SignWell /contracts (41) | DocuSign, Adobe, Dropbox, Documenso |
| Integrations directory | DocuSign (1,000+, incl. MCP), Dropbox Sign (19) | most challengers |
| Trust center | DocuSign (/trust with 8 sub-areas), Dropbox (trust.dropbox.com), BoldSign, SignWell, DocuSeal | Documenso (/security 404), OpenSign (none), signNow (shell), Jotform Sign (no badges) |
| Developer landing with code on page | BoldSign (6 languages), DocuSeal (api/embed/mobile tabs, AI-agent plugins) | Documenso (no code), DocuSign (separate portal) |
| Public changelog | DocuSeal (weekly), Documenso (bi-weekly) | incumbents |
| Open metrics | Documenso /open | everyone else |
| MCP / AI-agent page | DocuSign, signNow, SignWell, DocuSeal, PandaDoc | rest |
| Legality by country | DocuSign Legality Guide, signNow /legality | rest |
| Public document verify page marketed | nobody | everyone |
| Signer-side UX as hero | nobody | everyone |

### 1.5 Top complaints (G2, Capterra, community, Reddit)

- Price and "expensive" is the number one DocuSign complaint (27 G2 mentions), then envelope quota pressure (100/user/year) and surprise per-transaction fees.
- Adobe: cancellation fee shock, transaction cap not disclosed, dense UI, API enterprise-only.
- Dropbox Sign: 3-request free plan, template caps, template editor quality, billing complaints, no payments.
- signNow: pricing hidden behind a JS app, invite caps, API and SSO only via Site License.
- PandaDoc: add-on sprawl described as hidden costs.
- Jotform: single user until Enterprise, Sign buried inside form quotas.
- Reliability and support complaints recur for DocuSign (envelopes marked sent never delivered, unresponsive support).

### 1.6 Gaps nobody fills

1. Signer payments marketed as a headline, not a bullet. Dropbox has none; DocuSign gates it at $45/user; PandaDoc at $49/user.
2. Everything unlocked on every paid plan: API, SSO, branding, templates, unlimited envelopes, no metered surprises. BoldSign is closest but has no payments and no SSO below $15/user.
3. A public, third-party verifiable document page (`/verify/{id}`) as a trust proof. SignerPro already ships one.
4. The recipient's signing experience shown in the hero, on a phone.
5. A challenger-vs-challenger comparison hub (only Xodo vs DocuSeal exists).
6. Self-serve white-label under $100. Documenso wants $250, others custom.
7. A real trust center at SMB price points with a downloadable sample audit certificate.
8. Design quality as positioning: one polished, motion-aware, dark-mode-native brand in a field of Elementor, Wix and Webflow templates.
9. Templates paired with a working free-signing flow on the template page itself.
10. Public roadmap with voting.

---

## 2. Marketing-site design system research

### 2.1 How Stripe, Linear, Vercel, Resend, Cal.com and Clerk split marketing from product tokens

Same primitives, different semantic layer. Marketing adds: a display type tier (48 to 96px) the app never uses, a section spacing tier (96 to 192px), one or two atmosphere surfaces (gradient mesh, true black, cream), and pill-radius CTAs versus 6 to 8px controls in-app.

| Site | Display scale | Tracking | Canvas | Section spacing | CTA radius |
|---|---|---|---|---|---|
| Vercel Geist | heading-72/64/56/48/40/32 (marketing only) | -0.05em at 48px | #fafafa page, #fff cards | 96, `section` 192 | pill 100px |
| Linear | 80/56/40, weight 600, lh 1.05 | -3px at 80px | #010102 near-black, surface ladder #0f1011 to #191a1b, no drop shadows | 96 | pill |
| Stripe | 56/48/32/26, weight 300 Söhne | -1.4px at 56px | #f6f9fc, cream #f5e9d4, gradient mesh hero only | 64 to 96 (app 32 to 48) | pill 9999 |
| Resend | 96/76/56/44 Domaine Display serif | -0.96px | #000 true black, cards #0a0a0c | 96, bands 128 | 8px, white button on black |
| Cal.com | Cal Sans 64/48/36/28 weight 600 | -2px at 64px | #fff, footer #101010 | 96 | 8px, pills for tags |
| Clerk | 64px hero Geist | | white, purple #6c47ff | | 6px "sharp" |

Fluid type: the big brands ship stepped breakpoints. Utopia-style `clamp()` is the recommended replacement for display sizes only; body stays on a discrete rem scale. Keep min and max in rem and test at 200% zoom (WCAG 1.4.4).

Reference formula: `slope = (max - min) / (maxVW - minVW)`, `intercept = -minVW * slope + min`, `font-size: clamp(min, intercept + slope*100vw, max)`.

Sources: vercel.com/geist/typography, vercel.com/geist/colors, linear.app/brand, cal.com/font, fontsinuse.com/uses/35338 (Stripe Söhne), github.com/VoltAgent/awesome-design-md, shadcn.io/design, utopia.fyi/blog/clamp.

### 2.2 Conversion benchmarks

- Unbounce (41k pages): all-industry median 6.6%, SaaS median 3.8%. Email traffic 16.9%, paid search 5.1%. Copy at grade 5 to 7 reading level converts 12.9% vs 2.1% for "professional" copy. Best length 250 to 725 words.
- HubSpot: social proof directly under the CTA +68%; 3-field forms 10.1% vs 9-field 3.6%.
- Pricing pages: average 3 to 5% to signup or demo, top 7 to 10%. Transparent pricing yields 2 to 3x demo requests versus contact-sales only. Three tiers convert 1.4x versus two, 1.8x versus four or more. Default the toggle to annual; annual-default lifts annual adoption 25 to 35%.
- Navattic 2026: interactive demo beats product video by 12% on conversion; ungated demos +6% engagement; 5 to 12 steps; homepage placement rose from 8% to 48% of sites in a year.
- Baymard SaaS: 20% of SaaS sites never show the actual UI; 33% lack industry pages; 93% do not link plan-matrix features to feature pages.
- Exit-intent popups convert 2.01% for B2B, the lowest vertical. Prefer an inline closing CTA band.
- Julian Shapiro hero formula: Purchase rate = Desire minus (Labor plus Confusion). H1 must be fully descriptive on its own; sub explains how so the claim is believable; CTA copy continues the narrative ("Start signing", not "Request a meeting").
- Trust badges: at most 3 proof points near the primary CTA (one rating, one logo, one badge). Seven badges in a healthcare hero dropped demo requests. Full wall belongs on /trust.

### 2.3 Programmatic SEO patterns

| Pattern | URL | Exemplar | What keeps it from being thin |
|---|---|---|---|
| Templates | /templates/<type> | Notion (~355k/mo), Canva, SignWell /contracts | a real usable template object per page |
| Versus | /vs/<competitor> | ClickUp (credited in path to $25M ARR), G2 compare | honest matrix, screenshots, concessions |
| Alternatives | /alternatives/<competitor> | PandaDoc ranks #2 for "DocuSign alternative" | ranked list including competitors |
| Integrations | /integrations/<app> | Zapier pairs (2.3M/mo) | setup steps, triggers per pair |
| Industries | /solutions/<vertical> | signNow (8), SignWell (11) | vertical compliance, logos, templates |
| Legality | /legality/<country> | DocuSign Legality Guide | ESIGN, UETA, eIDAS specifics |
| Free tools | /sign-pdf, /online-signature | SignWell, Adobe | a working tool |

Add `SoftwareApplication`, `FAQPage`, `BreadcrumbList` JSON-LD; link the whole set from the footer.

### 2.4 Trust center contents (Drata, Vanta, DocuSign)

Badge wall (SOC 2, ISO 27001, HIPAA, GDPR, eIDAS, ESIGN, UETA); public versus NDA-gated documents; controls grouped by product security, app security, data privacy, infrastructure, BC/DR; subprocessor list; status page; last-updated date; for a signing product, a legality guide and a downloadable sample audit certificate.

### 2.5 Performance and accessibility targets

- Core Web Vitals at p75 mobile: LCP 2.5s (aim 2.0), INP 200ms (aim 150), CLS 0.1 (aim 0.05). Preload the hero image, `fetchpriority="high"`, no lazy-load above the fold, reserve space for iframes and logo strips, self-host fonts with `size-adjust` fallbacks, defer third-party scripts, no WebGL on mobile.
- WCAG 2.2 AA additions: focus not obscured by sticky headers (2.4.11), drag alternatives for sliders (2.5.7), 24px targets (2.5.8), consistent help placement (3.2.6), no redundant entry in multi-step forms (3.3.7), accessible authentication (3.3.8). Contrast 4.5:1 body, 3:1 for text 24px and up. Muted grays like #888 on #fafafa fail.
- Budget: JS under 150KB gzipped on landing pages, at most 2 font families and 4 files, Lighthouse accessibility 100, primary CTAs 44px tall.

---

## 3. Source index

Incumbents: docusign.com, docusign.com/products/electronic-signature, ecom.docusign.com/plans-and-pricing/esignature, docusign.com/vs/docusign-vs-adobe-sign, docusign.com/trust, adobe.com/acrobat/business/sign.html, adobe.com/acrobat/business/pricing.html, helpx.adobe.com/sign/using/transaction-limits.html, sign.dropbox.com, sign.dropbox.com/products/dropbox-sign/pricing, sign.dropbox.com/vs/dropbox-sign-api-vs-docusign-api, trust.dropbox.com.

Mid-market: pandadoc.com/pricing (blocked), pandadoc.com/alternatives/docusign, signnow.com, signnow.com/alternative, signnow.com/api, signwell.com, signwell.com/pricing, signwell.com/docusign-alternative, signwell.com/security, signwell.com/contracts, jotform.com/products/sign, jotform.com/pricing, jotform.com/jotform-sign-vs-docusign.

Challengers: documenso.com, documenso.com/pricing, documenso.com/platform, documenso.com/open, opensignlabs.com, boldsign.com, boldsign.com/pricing, boldsign.com/esignature-api, boldsign.com/docusign-alternative, eversign.com, eversign.com/pricing, docuseal.com, docuseal.com/pricing, docuseal.com/developers, zoho.com/sign.

Reviews: g2.com/products/docusign/reviews, g2.com/products/adobe-acrobat-sign/reviews, g2.com/products/hellosign/reviews, community.docusign.com, community.adobe.com, capterra.com.

Design and conversion: vercel.com/geist, linear.app/brand, cal.com/font, utopia.fyi, unbounce.com/conversion-benchmark-report/saas-conversion-rate, julian.com/guide/startup/landing-pages, growth.design/case-studies/landing-page-ux-psychology, baymard.com/blog/saas-website-ux-best-practices, navattic.com/report/state-of-the-interactive-product-demo-2026, figma.com/resource-library/pricing-page-best-practices, zapier.com/blog/programmatic-seo, trust.drata.com, web.dev/articles/vitals, w3.org/WAI/standards-guidelines/wcag/new-in-22.
