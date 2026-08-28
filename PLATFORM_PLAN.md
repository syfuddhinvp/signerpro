# SignFlow Platform Readiness

From working product to sellable platform.

The signing engine is genuinely built — fields, tokens, consent, OTP, tamper-evident
finalization. What is missing is everything that turns it into a product other companies
can buy, plug in, and trust.

Findings cite `backend/app` and `frontend/` at commit `989c72e`.

---

## 1. Baseline — what actually exists

The gap list only makes sense against a real baseline. This is more complete than most
projects at this stage.

- **Signing core is real.** Normalized PDF coordinates, per-recipient field ownership,
  parallel *and* sequential workflows with automatic activation of the next signing group,
  decline handling, void, reminders.
- **Compliance layer is real.** ESIGN/UETA consent gating (fields and the PDF URL are
  withheld until consent is accepted), IP and user-agent capture, an audit log on every
  meaningful event, SHA-256 hashes of original and final PDF, an appended audit certificate.
- **Signer tokens are done correctly.** Only the SHA-256 hash is stored, tokens carry an
  expiry and a revocation column, and every public route resolves the token rather than
  accepting IDs.
- **Tenant scoping is consistently applied.** Every document read passes through
  `get_for_user`, which compares `organization_id`. That discipline holds across the
  service layer.
- **Per-tenant gateways.** Organization-level SMTP plus switchable Twilio/Telnyx SMS, and
  the response schema deliberately omits the secret fields.

So the problem is not the product. It is that *SaaS* is currently three string columns on
`organizations` that nothing reads.

---

## 2. The gaps, ranked

Ordered by severity, not by area.

### Blocking correctness & security

#### 🔴 Any tenant admin is a platform super-admin

`require_super_admin` checks `current_user.role == "admin"` — but `admin` is a *tenant*
role, not a platform role. Any customer who holds it can list every organization and every
user in the system, and rewrite any tenant's subscription tier. **This is cross-tenant data
exposure and billing tampering in one endpoint group.**

`backend/app/api/routes/saas.py:22` · `models/enums.py:UserRole`

#### 🔴 New organizations can never configure themselves

Registration always creates a fresh organization with the user's role hard-set to `sender`.
But `PATCH /api/organizations/me` requires `admin`. **A self-serve signup therefore has no
path to ever set its own SMTP or SMS gateway** — only the seeded platform admin can promote
someone. There is also no team-invite flow at all, so a second user in the same org is
currently impossible.

`services/auth_service.py:register` · `routes/organizations.py:41`

#### 🔴 Subscription tier is decorative

`subscription_tier`, `subscription_status` and `subscription_expires_at` are written and
displayed, but no code path reads them. A canceled or expired tenant keeps full access; a
free tenant can send unlimited documents. There is no entitlement check on document
creation, send, seat count, or storage.

`models/organization.py` · no consumers found across `app/`

#### 🔴 No rate limiting anywhere, including OTP

OTP codes are six digits, stored in plaintext, compared with `!=`, and `/otp/verify`
accepts unlimited attempts with no lockout and no attempt counter. A 10-minute window
against 10⁶ codes is brute-forceable. The same absence lets an attacker grind
`/api/sign/{token}` and `/api/auth/login`.

`services/signing_service.py:300–362`

### Platform & operations

#### 🟠 No billing system exists

No payment provider, no plan catalogue, no usage metering, no invoices, no trial clock, no
dunning, no provider webhook receiver. Tiers are free-text strings rather than rows in a
`plans` table, so pricing changes mean a migration.

#### 🟠 No background workers

Final PDF generation, email dispatch, and SMS all run inline inside the HTTP request, with
no retry on failure. And because nothing is scheduled, the `expired` / `token_expired`
statuses and audit events that the spec defines can never actually fire — expiry is only
evaluated lazily when someone happens to open a link.

#### 🟠 Single-node file storage

PDFs live on local disk and are served through `FileResponse(storage.path(...))`. That
prevents horizontal scaling, loses documents on container replacement, and provides no
encryption at rest for what are, by definition, legally significant records.

#### 🟠 Session handling is thin

8-hour JWTs in `localStorage` with no refresh token, no revocation list, no `jti`, and no
logout that invalidates server-side. Missing alongside it: email verification, password
reset, and MFA for senders — all table stakes for a product handling contracts.

`core/security.py` · `frontend/lib/auth.ts`

#### 🟠 No observability

Integration and email paths report via `print()`. No structured logging, request IDs, error
tracking, or metrics. When a signature fails for a customer at 2am there is currently no way
to find out why.

#### 🟡 Reminders mint tokens without revoking the old ones

`create_for_recipient` issues a fresh token on every reminder and never sets `revoked_at` on
prior ones. Every reminder therefore leaves another live signing link in an inbox for the
full 14-day window.

`services/token_service.py:20` · `routes/documents.py:remind_document`

#### 🟡 Tenant gateway secrets stored in plaintext

The API response correctly hides them, but SMTP passwords, Twilio auth tokens, and Telnyx
API keys sit unencrypted in Postgres columns. A database dump or read-replica leak hands
over every customer's mail and SMS provider.

#### 🟡 Schema managed two ways

`Base.metadata.create_all` runs at startup in development while Alembic owns migrations. The
two drift, and the drift only surfaces in production where `create_all` is off.

`app/main.py:startup`

#### 🟡 CRM integration is a simulation

`CRMIntegrationService` writes audit rows describing what *would* happen — no outbound HTTP,
no configuration, no delivery guarantees. This is the single largest gap between the
README's promise and the code, and it is also the seam that section 3 turns into the real
product surface.

#### 🟡 No data lifecycle

No retention policy, no soft delete, no GDPR/CCPA export or erasure, no legal-hold.
Meanwhile `cascade="all, delete-orphan"` from Organization means deleting a tenant destroys
signed documents that customers are legally required to retain.

---

## 3. Becoming an add-on, not an app

"Integrate with any application" is really four separate surfaces. Most teams build only the
first and wonder why nobody integrates. Build them in this order — each one is useful before
the next exists.

### 3.1 A public API with its own credentials

Today the only way in is a user's login JWT. Machine callers need a separate identity: an
`api_keys` table scoped to an organization, with a hashed secret, a prefix for display
(`sk_live_a1b2…`), granular scopes, a last-used timestamp, and independent revocation.
Version the surface at `/v1/` and freeze it — the current `/api/` routes stay internal to
your own frontend, which lets you keep changing them.

Two additions make it usable at scale: **idempotency keys** on every POST, so a retried
"send document" doesn't sign twice, and **cursor pagination** on every list endpoint, since
`list_documents` currently returns a tenant's entire history unbounded.

### 3.2 Outbound webhooks — replacing the CRM simulation

Every audit event the system already emits is a webhook payload waiting to happen. This is
the cheapest high-value work in the plan, because `AuditLog` is *already* the complete event
stream.

> **Do this generically, not per-CRM.** The current design hardcodes Salesforce-shaped
> concepts — loan milestones, realtor pipelines — into the core. Emit neutral events
> (`document.completed`, `recipient.signed`) and let each integration map them. Otherwise
> every new CRM means touching the signing engine.

Requirements that matter: HMAC-SHA256 signature over the raw body with a per-endpoint
secret, a replay-guarding timestamp, at-least-once delivery with exponential backoff, a
dead-letter view in the dashboard, and a delivery log the customer can inspect and replay.

```
# tables to add
webhook_endpoints   organization_id, url, secret, event_types[], active
webhook_deliveries  endpoint_id, event_id, attempt, status_code, next_retry_at
```

### 3.3 Embedded signing — the actual add-on

This is what "plug into any application" means to a buyer: their users never see your brand
or leave their app. The good news is that the token model already supports it — a signing
token is a bearer credential tied to one document and one recipient, which is exactly what
an embed needs.

- **Short-lived embed sessions.** A server-to-server call exchanges an API key plus
  recipient ID for a single-use URL valid for minutes, not the 14 days a mailed link gets.
- **An iframe-safe signing route** with a strict `frame-ancestors` CSP allow-list per
  tenant, replacing today's blanket `allow_origins` CORS list.
- **A thin JS SDK** that mounts the iframe and relays `postMessage` events — `ready`,
  `completed`, `declined` — so the host app can react inline.
- **An embedded *preparation* view** too, not just signing. Letting a partner's user place
  fields without leaving their product is the feature that closes deals.
- **White-labelling**: per-tenant logo, accent color, sender name, and custom domain for
  signing links. Section 4 is what makes this a config change rather than a fork.

### 3.4 Connectors, once the three above exist

OAuth 2.0 authorization-code flow so third-party apps can act for a tenant without holding a
raw key, then the marketplace listings that actually drive inbound: Zapier and Make first
(cheapest reach), then a native HubSpot or Salesforce app. None of these are worth starting
before webhooks and the public API are stable.

---

## 4. A professional design token system

The current setup is a reasonable start with four structural problems: the palette is
duplicated between `tailwind.config.ts` and `globals.css` as literal HSL values, so they can
silently diverge; there is no dark mode and no runtime theming hook, because Tailwind's
config bakes colors in at build time; components bypass the tokens the moment they need a
color that isn't there (`Badge.tsx` reaches for raw `red-100` and `emerald-100`); and only
color is tokenized — spacing, radius, type, elevation, and motion are ad-hoc per component.

> **The one architectural change:** define tokens as CSS custom properties on `:root`, and
> have Tailwind reference the variables rather than own the values. Every downstream
> capability — dark mode, per-tenant white-labelling, high-contrast — becomes a variable swap
> on a single element instead of a rebuild.

```css
/* tokens.css — one source of truth */
:root {
  /* primitives: raw values, never used directly by components */
  --teal-600: 174 68% 28%;
  --amber-500:  31 92% 52%;

  /* semantic: what components actually consume */
  --color-bg-canvas:      42 18% 98%;
  --color-fg-default:    218 24% 13%;
  --color-accent-solid:  var(--teal-600);
  --color-border-subtle: 210 18% 86%;
}
[data-theme="dark"] { --color-bg-canvas: 218 24% 9%; /* … */ }
```

Three layers, and the middle one is the one that matters:

1. **Primitives** — the raw ramp. Each hue needs 9–11 steps, not one value; `primary/90`
   opacity hacks in `Button.tsx` are a symptom of a missing scale.
2. **Semantic** — named by role, never by appearance: `--color-fg-muted`,
   `--color-bg-danger-subtle`. Components only ever touch this layer. This is also the layer
   a tenant's brand color overrides.
3. **Component** — only where a component genuinely needs its own knob, e.g.
   `--button-height-md`.

### Scales to add

| Scale | Today | Target |
|---|---|---|
| Color | 8 flat values | 3-layer, 9-step ramps, light + dark |
| Type | Tailwind defaults | Named roles: display, heading-1..3, body, label, code |
| Space | ad-hoc per component | 4px base, 8-step ramp |
| Radius | `rounded-md` by habit | none / sm / md / lg / full, assigned by role |
| Elevation | one `shadow-panel` | 4 levels, redefined for dark (shadows fail on dark) |
| Motion | bare `transition` | duration + easing tokens, `prefers-reduced-motion` |
| Focus | browser default | `--focus-ring` applied via `:focus-visible` |
| Z-index | none | named layers — required, PDF overlays stack |

### Fixes that fall out of this

- Rename `primaryForeground` → `primary-foreground`. camelCase breaks Tailwind's
  `bg-primary-foreground` convention and is why it reads awkwardly at call sites.
- Give `StatusBadge` a semantic status token per document state, so `declined` and `voided`
  stop borrowing Tailwind's stock red.
- The spec called for shadcn/ui; the five hand-rolled primitives in `components/ui/` lack
  focus management and ARIA. Adopting shadcn on top of the token layer gets accessibility
  for free and keeps the tokens.
- Signature ink color, field-overlay tints, and recipient color-coding in the PDF editor are
  all design decisions currently hardcoded in component files — they belong in the token
  layer, and per-recipient colors need to be colorblind-safe.

---

## 5. Sequence of work

Ordered by dependency, not by appeal. Each phase leaves the product shippable.

### Phase 1 — Close the holes

*Nothing else is safe to build on top of these.*

- Split platform role from tenant role — add `is_platform_admin` on `User` and repoint
  `require_super_admin`.
- First user of a new organization becomes its `admin`; add an invite flow so orgs can have
  more than one member.
- Rate limits on login, OTP send, OTP verify, and token resolution; hash OTP codes, add an
  attempt counter and lockout, compare with `secrets.compare_digest`.
- Revoke prior signing tokens when a reminder issues a new one.
- Encrypt tenant gateway secrets at rest; drop `create_all` from startup and let Alembic own
  the schema.

### Phase 2 — Make it a real tenancy

*Turn the three subscription columns into an enforced model.*

- `plans` and `subscriptions` tables; entitlements as data, not strings.
- A single `check_entitlement()` dependency enforced on document create, send, seat add, and
  storage.
- Usage metering rows per billable event, which billing and the customer dashboard both read.
- Payment provider integration: checkout, provider webhook receiver, trials, dunning,
  self-serve plan change.
- Session hardening: refresh tokens, revocation, email verification, password reset.

### Phase 3 — Production operations

*The work that only shows up when real customers depend on it.*

- Object storage behind the existing `storage` abstraction — the seam is already there —
  with server-side encryption and signed URLs.
- A job queue for PDF generation, email, SMS, and webhook delivery, plus a scheduler that
  actually expires documents and tokens.
- Structured JSON logs with request and tenant IDs, error tracking, uptime and latency
  metrics.
- Retention policy, soft delete, GDPR export and erasure, legal hold. Remove the destructive
  org-level cascade.

### Phase 4 — The integration surface

*Section 3, in build order.*

- API keys with scopes; versioned `/v1/`; idempotency keys; cursor pagination.
- Webhooks driven off the existing audit event stream, with HMAC signing, retries, and a
  delivery log — replacing the simulated CRM service.
- Embedded signing: short-lived embed sessions, per-tenant `frame-ancestors`, a
  `postMessage` JS SDK, then embedded preparation.
- OpenAPI-generated docs and a sandbox environment. Then OAuth, then Zapier, then a native
  CRM app.

### Phase 5 — Design system

*Can start in parallel — it blocks nothing and unblocks white-labelling.*

- Extract tokens to CSS custom properties; point Tailwind at the variables.
- Build the missing scales; migrate components off raw palette values.
- Ship dark mode — near-free once tokens are variables.
- Adopt shadcn/ui over the token layer for accessible primitives; audit focus, ARIA, and
  contrast, with particular attention to the PDF editor and signer flow.
- Per-tenant brand overrides, which is the same mechanism as theming.

---

## If you only do one thing

Fix the `saas.py` role check. It is a handful of lines, and until it lands, every customer
admin can read every other customer's data.
