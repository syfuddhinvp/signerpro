# SignForge — Full-Stack Audit Report

**Date:** 28 August 2026
**Scope:** `backend/` (FastAPI) and `frontend/` (Next.js 15 App Router), commit `8d3316e`
**Method:** seven parallel audit agents, each driving the real API through FastAPI `TestClient` and reading the frontend source. Findings below are backed by observed HTTP responses and file:line evidence, not by inspection alone.

---

## 1. Executive Summary

SignForge is a **well-architected prototype with a production-quality backend core and a demonstration frontend**. The gap between those two halves is where nearly every finding in this report lives.

The backend is not a mock. 271 tests pass. Tenant isolation genuinely holds — 40+ cross-organization probes all returned 403/404. The entitlement engine really enforces document, API-call and seat quotas (verified 402 at N+1). API keys are hashed, shown once, and scope-enforced. Inbound webhook signatures are verified in constant time with idempotency. Outbound webhook signing, backoff and after-commit dispatch are genuinely good design. Token generation is uniformly CSPRNG — `import random` appears nowhere.

But the product cannot be shipped, for four independent reasons, any one of which is disqualifying:

1. **The executed PDF is wrong.** Field coordinates are never origin-flipped between the browser (top-left) and ReportLab (bottom-left), so every field is stamped vertically mirrored. A signature placed on the signature line at the foot of page 3 lands across the header.
2. **Nobody ever sees the document.** `pdfjs-dist` and `react-pdf` are installed and imported by zero files. Both the builder and the signing surface render hardcoded contract prose. Senders place fields on fake content; signers legally attest to a document they were never shown.
3. **The audit trail is not tamper-evident**, despite being the product's core legal claim. The hash chain is computed on read and never persisted; `verify_chain` returns `valid: true` when called with no expected head, which is how it is actually called. An audit row edited directly in the database verified clean.
4. **There is no billing.** Any org admin can move themselves to the unlimited Enterprise plan in one unauthenticated-by-payment call, and nothing in the application ever constructs an `Invoice`.

Layered on top are three server-side authentication vulnerabilities — an MFA bypass, unenforceable session revocation, and a default `JWT_SECRET` with no production guard — and an impersonation system whose scopes, revocation and attribution are all decorative.

**Verdict: not production-ready.** The distance to production is real but tractable, because the seams for most fixes already exist in the codebase. Section 8 sequences the work.

### Scorecard

| Area | Backend | Frontend | Notes |
|---|---|---|---|
| Tenant isolation | **Strong** | n/a | 40+ probes clean; zero regression coverage |
| Entitlements & quotas | **Strong** (3 of 6 dims) | Partial | `api_access`/`webhooks`/`custom_branding` unenforced |
| Auth & session | **Broken** | **Broken** | 3 server-side vulns; MFA users cannot log in |
| Document lifecycle | Strong | **Broken** | Coordinates mirrored; canvas is fake |
| Signer journey | Strong | **Broken** | Signs fake paper; co-signer field disclosure |
| Audit & certificate | **Broken** | Partial | Chain not persisted; verify always true |
| Billing | **Absent** | Misleading | No charge, no invoice, false PCI claim |
| Platform ops | Partial | Partial | Impersonation & suspension cosmetic |
| Prod readiness | **Weak** | **Weak** | Dev Dockerfiles, no CI, no migration runner |
| Test coverage | 271 tests | **0 tests** | No CI runs either suite |

---

## 2. Critical Register

Consolidated across all seven audits, deduplicated. Each is independently ship-blocking.

| # | Finding | Evidence | Impact |
|---|---|---|---|
| **C1** | Final-PDF fields are vertically mirrored — px→pt conversion has no origin flip | `frontend/lib/sf/adapters.ts:573-574` vs `backend/app/services/pdf_service.py:139` | Measured: field authored ~150px from top stamped at `y=612` on a 792pt page. Every executed contract is wrong. |
| **C2** | The real PDF is never rendered — `pdfjs-dist`/`react-pdf` imported by zero files | `Builder.tsx:436-447`, `Signer.tsx:225-230` | Senders place fields on hardcoded MSA prose; signers attest to a document they never saw. Invalidates the ESIGN consent captured one screen earlier. |
| **C3** | MFA challenge token works as a full access token — `purpose` is never checked | `backend/app/api/deps.py:16-31` vs `auth_service.py:250-255` | Verified: `Bearer <mfa_token>` → `/api/auth/me` 200. Password alone = account takeover, and can `POST /mfa/disable` (which needs no password) to strip 2FA permanently. |
| **C4** | Session revocation is not enforced — `revoked_at` and `sid` are never consulted | `backend/app/api/deps.py:16-31`; `models/user_session.py:29` | Verified: `me-after-logout 200`, `me-after-revoke 200`. Logout, "sign out all devices" and admin-forced logout are all cosmetic for 8 hours. |
| **C5** | `JWT_SECRET` defaults to a published constant with no production guard | `backend/app/core/config.py:14`; `docker-compose.yml:22` | Anyone who reads this repo mints a token for any `sub`, including `is_platform_admin`. `crypto.py:73` already implements exactly the guard that is missing here. |
| **C6** | The audit chain is not tamper-evident, and audit rows are deletable | `audit_service.py:105-132`; `api/routes/audit.py:55,76`; `models/document.py:62` | Chain computed on read, `chain_head` persisted nowhere. Verified: edited an `event_message` in the DB, `/verify` returned `valid: true`. `chain_valid=True` is a hardcoded literal. Purging a document destroys its trail. |
| **C7** | There is no billing — free self-upgrade to unlimited, and no invoice is ever generated | `billing_service.py:196-197,426`; `grep "Invoice(" backend/app` | Verified: new free org → `enterprise` in one 200 response, then +5 seats, with `charges: []` and `invoices: []`. Every invoice in a running system comes from the seed script. |
| **C8** | Impersonation: scopes unenforced, not revocable, misattributed | `platform_service.py:503-556`; `deps.py:16-31` | Verified with a `scopes:["read"]` token: retitled a document, trashed one, and created a live **admin invite** to the customer's org. `DELETE /impersonation` returned `ended_sessions: 1`; the token still worked. Actions log as the tenant's own user. |
| **C9** | `pypdf==5.1.0` (~27 advisories) parses every uploaded PDF; `next@15.1.3` has a critical RCE and a **middleware auth-bypass** | `pip-audit`, `npm audit` | `frontend/middleware.ts` *is* the app's route guard. Fixes: `pypdf>=6.15.0`, `next>=15.5.24`. |
| **C10** | `0001_initial` is `Base.metadata.create_all`, and nothing runs `alembic upgrade` | `migrations/versions/0001_initial.py:19-24`; `backend/Dockerfile:19` | Migration drift detection is vacuous by construction (`compare_metadata()` returned zero diffs — meaninglessly). A fresh `docker compose up` points the app at an empty database. |
| **C11** | Both Dockerfiles are development images | `frontend/Dockerfile` (`CMD npm run dev`), `backend/Dockerfile` | Ships the Next dev server to production: no `next build`, source-exposing error overlays, and `secure` cookies disabled because `NODE_ENV !== 'production'`. Both run as root. |

---

## 3. Authentication & Identity

**Backend endpoints exist and mostly work; the frontend does not call them.** Register, login, MFA enroll/challenge/verify/recovery-codes, password forgot/reset, session list/revoke and refresh are all implemented and were driven successfully. The frontend fakes four of them.

### Broken end to end

- **MFA users cannot log in.** `handlers.ts:86-101` correctly returns `{ok:true, mfaRequired:true, mfaToken}`, but `SignInForm.tsx:65-73` only checks `data.ok` — the challenge is `ok:true`, so it falls through to `router.replace(undefined)` and discards the token. Even if reached, `MfaForm.tsx:32-42` accepts **any 6 digits**, calls nothing, and flashes "Signed in to Acme Corporation" without minting a cookie. The working route handler `app/api/auth/mfa/route.ts` is dead code.
- **Password reset is dead on both halves.** `ForgotForm.tsx:24-28` fabricates "Reset link sent … valid 30 minutes" with no network call (the real TTL is 60 min), and the backend emails `{app_base_url}/reset-password?token=…` — **a route that does not exist**. Every reset email 404s.
- **Invitations are unredeemable.** `invitation_service.py:29` mails `/invite/{token}`; there is no `frontend/app/invite/` route. The `invitations.*` resources have zero callers, so nothing in the UI can send one either. Accepted invites also create a **session-less identity** (`invitation_service.py:132` — no `UserSession` row), so the new member has no refresh token and cannot be revoked.
- **Change password** is wired to the wrong handler — `AccountArea.tsx:213` "Change" calls `addEmail`.

### Security findings

1. **MFA bypass (C3)** — `purpose` claim never validated.
2. **MFA challenge tokens and TOTP codes are replayable for 5 minutes.** Nothing marks the token consumed or records the used TOTP step. Verified: the identical `(mfa_token, code)` pair returned 200 three times, minting three independent 12-hour sessions.
3. **Session revocation unenforced (C4).**
4. **The frontend logout never reaches the backend.** `app/api/auth/logout/route.ts:4-15` clears the cookie only; the `UserSession` row and refresh token survive forever.
5. **The session cookie is decoded, never verified.** `lib/auth/edge.ts:20` ("Decode (never verify)") and `session.ts:70-97`, then `middleware.ts:36` gates `/platform` on `env.u.is_platform_admin` read straight out of it. A forged envelope loads the entire platform-admin UI shell. Data fetches still 401 upstream, so this is structure/UI disclosure rather than tenant data — but the guard is not a guard.
6. **`POST /mfa/disable` requires no password.** The service accepts a `password` argument no caller supplies. Combined with C3 or C4, a stolen token silently strips 2FA *and* nulls all recovery codes, with no re-auth and no notification.
7. **Login timing oracle.** Identical 401 bodies (good), but bcrypt only runs when the user exists: ~197 ms vs ~2.4 ms. An 80× oracle that enumerates registered addresses trivially.
8. **"Remember this device" is inert** — the toggle is never transmitted. Separately, the cookie `maxAge` is 12h while the JWT inside expires at 8h, so for four hours users are bounced to `/login` while a stale cookie sits on disk.

---

## 4. Document Lifecycle (Sender Journey)

**What works** (all driven live): upload with real validation — extension, `%PDF` magic bytes, size limit read as `limit+1` so an oversized file cannot exhaust memory, and 409 on re-upload for original immutability. Sequential vs parallel routing. Field CRUD with full-replace semantics that preserve captured values, coordinate bounds-checking against the real page mediabox, and a post-send edit lock (409). Send pre-flight validation. Remind, resend, void. List/filter/search/sort/counts, favorite, rename, duplicate, archive, trash/restore, move, bulk ops, bulk zip download. Templates and folders end to end. Signature stamping — typed renders as `Times-Italic`, drawn embeds as a page XObject.

### Findings

1. **Coordinates are vertically mirrored (C1).** Compounded by `Builder.tsx:202-203` hardcoding the sheet to 816×1056px (US Letter @96dpi) — any A4, Legal or landscape upload is additionally misplaced.
2. **The builder shows fake content (C2).** `GET /api/documents/{id}/pdf` works (verified 200) and is never called.
3. **Conditionally-hidden required fields permanently deadlock the signer.** `field_service.py:230-234` *rejects* writes to a condition-unmet field; `signing_service.py:223-225` computes `missing` without filtering on condition. Verified: with "Has spouse" unchecked, writing "Spouse name" → 400 "hidden by its conditional rule", and `complete` → 400 "Required fields are incomplete: Spouse name". The canonical conditional pattern ships an unfinishable envelope with no signer-side recovery.
4. **Dropdown/radio options are never enforced server-side.** `validate_value` never inspects `field.options`. Verified: a dropdown authored `["A","B"]` accepted `"ZZZ-not-an-option"` (200), and that string is flattened verbatim into the executed contract.
5. **Initials fields cannot be filled.** The UI routes `initials` into the signature ceremony; `save_signature` rejects non-`signature` types → 400 "Field is not a signature field". A required initials field blocks completion outright.
6. **Envelopes never expire.** `expiry_service` has **no caller anywhere in `app/`**. `DocumentStatus.expired` is unreachable; signing links stay live past their stated expiry — a legal exposure, not just a bug. The Routing screen promises "Expires in N days · auto-void".
7. **`role: "copy"` and `role: "approve"` are stored but never read.** Verified: a CC recipient was emailed a signing link, was *required* by `validate_for_send` to own a signature field, and **blocked execution** until they signed.
8. **Ten library row actions are toasts**, including `Download`, `Print` and `Share` — while `GET /api/documents/{id}/final-pdf` works (verified 200) and bulk zip download is fully wired. `Library.tsx:369` fakes folder creation against a working `POST /api/folders`. Builder Undo/Redo/Preview are `flash()` calls.

### Field-type matrix

Builder palette (`lib/sf/data.ts:9-25`) vs what survives a save and what renders.

| Type | Persists as itself? | Rendered in final PDF | Note |
|---|---|---|---|
| signature | Yes | Image or italic text | Type-aware |
| checkbox | Yes | "X" glyph | Type-aware |
| initials | Yes | Plain text | **Unfillable via the UI** |
| date, name, text, number, currency | Yes | Plain text | No formatting or numeric coercion |
| radio, dropdown | Yes (+options) | Plain text | **Options unvalidated** |
| **stamp** | **No → `text`** | Plain text | Backend enum accepts `stamp` — frontend discards it |
| **attachment** | **No → `text`** | Plain text | No upload endpoint on the signing session at all |
| **formula** | **No → `text`** | Plain text | **Zero evaluation logic in either tier** |
| **datetime** | **No → `date`** | Plain text | Backend enum accepts `datetime` |

4 of 15 palette types lose their identity on the first save — gratuitously, since the backend accepts all four (verified 201). Only 2 of 15 get type-aware rendering; the other 13 are `drawString(str(value)[:160])`.

---

## 5. Signer Journey, Audit Trail & Certificate

**What works:** token entropy (`token_urlsafe(48)` = 384 bits, SHA-256 hashed at rest), lifetime capped to the envelope deadline, old links superseded on resend (verified 403). Email OTP send/verify with salted hashing and `compare_digest`. **OTP lockout is real** — observed `[400,400,400,400,429,429,429]`, and resend cannot clear it. ESIGN consent persisted with IP/UA. Gate enforcement (pre-gate: 0 fields, PDF 403). Cross-recipient field **writes** correctly blocked (403). Required-field enforcement. Sequential next-recipient advance. Decline and reassign. All ten signing-link states map to designed cards.

### Findings — security first

1. **A signer's session returns every other recipient's fields, including their values.** `signing_service.py:63` returns `document.fields` — the whole envelope — while only `assigned_field_ids` narrows it. Verified: Alice's session returned 3 field objects when 2 were hers, each with `recipient_id`, `label` and `value`. The frontend filters cosmetically, so anyone who opens devtools reads the co-signer's salary or SSN field the moment they clear consent. Disclosure only — writes are blocked — but complete.
2. **The audit chain does not detect tampering (C6).**
3. **The final PDF carries no cryptographic signature.** No PKCS#7/PAdES — probed the output, no `/Sig`, no `adbe.pkcs7`. And nothing re-hashes the file: appended bytes to `final.pdf` on disk, and `/certificate/summary` still reported the stale `final_sha256` as fact. A third party has no way to detect alteration, and neither does the platform.
4. **`/api/sign/{token}/pdf` stays live after completion.** `complete` sets `used_at` but leaves `revoked_at` null (verified). A forwarded email or shared-device history re-reads the document for the full token lifetime.
5. **OTP throttling is token-keyed and single-node.** The per-recipient lockout is the only defence that survives a restart or a second replica. Resend-and-retry yields ~25 guesses per 10 min out of 10⁶ — reduced, but the layered defence is thinner than it appears.

### Findings — functional

6. **The signing surface never shows the document (C2).** This is the single largest gap in the journey.
7. **Initials unsignable; attachment fields non-functional** (no upload endpoint; rendered as a text input).
8. **A signer can never obtain the signed copy.** `/api/sign/{token}/pdf` always serves `original_file_path`; the `final_pdf_url` returned by `complete` requires a session (verified 401). The UI button is literally labelled "Download unsigned PDF" while the completion card promises an emailed copy.
9. **Nobody is notified of anything except the initial invite.** `email_service.py` has exactly one method, `send_signing_link`. No completion, decline or view email exists. `decline()` never calls the already-written `crm_service.trigger_document_declined`, so even the webhook is silent — while the UI says "Signing declined · sender notified".
10. **OTP and email audit events lose IP/UA.** `signer_otp_sent/_verified/_locked/_email_sent` are logged with `None` for both — precisely the identity-verification events a dispute turns on.
11. **Consent is captured without a versioned record of what was consented to.** `consent_version` is a hardcoded `"1.0"` schema default; the disclosure text lives only in JSX. Change the copy and every prior acceptance silently re-points at it.
12. **No certificate-of-completion PDF** (404). The content exists inside the final PDF — this is a missing export, not missing data. The UI is honest about it.
13. **The QR verification block encodes nothing.** `Audit.tsx:24-48` seeds a PRNG from the URL and draws QR-shaped cells, captioned "Scan to verify at the public endpoint". It will not scan, and there is no public verification endpoint for it to point at.
14. **The signing surface is unusable on a phone** — fixed 816×1056px sheet with absolutely-positioned fields and no scale transform. Most e-signature traffic is mobile.
15. **A non-revoked 403 always renders "waiting on an earlier signer"** (`types.ts:413`), so OTP and consent 403s are reported as a routing problem the signer cannot act on.

---

## 6. Platform Operations & Multi-Tenancy

### Tenant isolation — the strongest result in this audit

Org A and org B were registered, A's resources created, then **every read and mutating call was reissued with B's bearer token**. All returned 403/404.

| Resource | Cross-org read blocked | Cross-org write blocked | Covered by existing tests |
|---|---|---|---|
| Documents (get/patch/pdf/audit-logs/trash) | Yes (404) | Yes (404) | **No** |
| Folders, Contacts, Templates, Teams | Yes (404) | Yes (404) | **No** |
| API keys, Webhooks, Custom reports | Yes (404) | Yes (404) | **No** |
| Invoices, Support tickets | Yes (404) | Yes (404) | Yes |
| Tenant logs, activity | Yes | n/a | Yes |
| All 23 `/api/saas/*` routes as a tenant | Yes (403) | Yes (403) | Yes |
| Tenant-admin → platform-admin escalation | Blocked | Blocked | Partial |

**But `test_tenancy.py` contains no cross-org data probes at all.** Its 10 tests cover org creation, invitations, member roles, seat caps and one platform 403. Documents, templates, contacts, folders, teams, API keys, webhooks, reports, invoices, logs and activity isolation are correct today with **zero regression coverage**.

### Findings

1. **Impersonation `scopes` is decorative (C8).** Stored at `platform_service.py:503-509`, read by no dependency. Verified with a `read` token: `PATCH /api/documents/{id}` → 200, `POST /{id}/trash` → 200, and `POST /api/invitations/ {"role":"admin"}` → 201, which **emailed a live single-use admin invite** to the customer's org. A support engineer with a legitimate 15-minute read justification can plant a permanent backdoor.
2. **Ending impersonation does not revoke the token.** `token_hash` is written at `:508` and read nowhere. After `DELETE /api/saas/impersonation` returned `{"ended_sessions": 1}`, the same token still returned 200 on org A's documents. `test_platform_admin.py:275` asserts the counter and the audit row — never that access stopped.
3. **Impersonated actions are attributed to the tenant's own user.** The JWT's `imp` claim is decoded nowhere; the middleware logs `actor_email` as the tenant's. The forged invite appeared in the tenant's own trail as their admin doing it, and the outbound email read "U a@a.com invited you…". This defeats the stated purpose of the audit trail.
4. **Tenant suspension has no effect.** `suspended_at` is read by no auth path (`grep` confirms). Verified: immediately after a successful suspend, the tenant's token created a document (201) and listed documents (200). The UI says "suspended — all envelopes frozen".
5. **Three privileged mutations are not audited**: `PATCH /api/saas/organizations/{id}` (changes plan tier and status), the three invoice operations, and billing-event replay. Verified: audit total was 1 before and 1 after upgrading an org to `enterprise/active`. An operator can silently grant an enterprise plan or mark a large invoice paid with no record.
6. **`security-posture` toggles claim controls that do not exist.** SSO, SCIM, IP allowlist, data residency, HSM rotation and DLP persist booleans; none is implemented. Believing "IP allowlist for admin console" is active is a live false-assurance risk.
7. **The compliance dashboard hardcodes certifications** — `platform_service.py:75-84` asserts SOC 2 Type II and HIPAA as `certified`, and `flags.py:255` admits `last_key_rotation_at` is invented because "there is no rotation job yet". This could be shown to a customer as evidence.
8. **Two role-assignment paths with different guards.** `tenants.py:503-563` refuses self-demotion and last-admin removal; `saas.py:139-176` does neither. Neither prevents demoting the last *platform* admin, which would lock everyone out of `/api/saas/*` permanently — there is no bootstrap route.
9. **`POST /api/saas/payouts` returns 404** and `Revenue.tsx:100` unconditionally flashes "Payout of $X requested". Fails closed financially, but the operator is told money moved.
10. **Step-up MFA is a `flash()`** and "Elevated session expires in 14 min" is a hardcoded string.

**Genuinely working here:** platform overview/metrics/health derived from real rows; tenant directory with real filters; global and per-tenant feature flags end to end (verified a forced override flipping a tenant's `/api/flags`); platform user directory; tenant and platform log streams with correct scoping; all six revenue endpoints derived from real subscriptions, invoices and charges; support queue with correct cross-org 404s and platform-only field guards.

---

## 7. Billing, Entitlements & Developer Platform

### Enforcement reality

| Quota / Entitlement | Shown in UI | Enforced server-side | Evidence |
|---|---|---|---|
| `max_documents_per_month` | Yes | **Yes** — 402 at N+1 | Verified: 6th doc on Team → `entitlement_limit_reached` |
| `max_api_calls_per_month` | Yes | **Yes** — before each key request | `api_key_service.py:144` |
| `max_users` | Yes | **Yes** — invite, accept, seat increase | `invitation_service.py:47,117` |
| `max_sms_per_month` | Yes | Soft — degrades to email | `signing_service.py:451` |
| Subscription active | Yes | **Yes** for create/send/upload | Verified 402 `subscription_inactive` |
| `max_storage_bytes` | Yes (with a bar) | **No** — metered, never checked | No `check_entitlement` call site exists |
| `max_recipients_per_document` | Yes | Bypassable — `used = 0`, so sequential single adds beat the cap | `entitlement_service.py:366` |
| **`api_access`** | Yes — gates the Developer screen | **No** | Verified: Team org (False) created a key and called `/api/v1` (200) |
| **`webhooks`** | Yes | **No** | Verified: Team org created 2 endpoints (201) |
| **`custom_branding`** | Yes | **No** | Zero call sites |
| Org suspension | Yes | **No** | See §6.4 |
| "Annual (save 12%)" | Yes | **No discount exists** — `monthly × 12` | `billing_service.py:628` |
| "API rate 500 rps" (Enterprise) | Yes | **No rate limiter is wired anywhere** | `grep RateLimiter(` outside `ratelimit.py` → 0 hits |
| "25 envelopes/seat/mo" (Team) | Yes | Enforced limit is **5 per org**, not 25 per seat | `plan.py:38` vs `:49` |

### Findings

1. **No billing exists (C7).** `change-plan` requires only org-admin, takes no payment method, and `NullPaymentProvider.change_plan` is `return None`. **Nothing in the application ever constructs an `Invoice`** — no renewal job, no period-close job; `current_period_end` simply lapses into `expired`. Ship this and every tenant is on Enterprise for $0 within a day.
2. **The three feature entitlements that constitute the entire Team→Business upsell are never checked.** The gating machinery (`entitlement_service.requires()`) is excellent and simply not applied to these keys.
3. **The card form takes a real PAN in first-party code under a false PCI claim.** `Modals.tsx:764` renders a "Card number" input, validates 12+ digits, and posts `'tok_card_' + last4`. The backend invents brand and expiry from `sha256(token)` — a `tok_x` probe returned "Visa •••• 2565, exp 5/2029". `Billing.tsx:151` prints `powered by Stripe · PCI DSS L1`. No Stripe code exists, and an unknown `BILLING_PROVIDER` **silently falls back to the null provider** rather than failing loudly.
4. **`Sandbox.tsx` runs real session-authenticated writes against the user's live tenant** while its footer reads "Sandbox calls run against a seeded test tenant. Nothing is emailed and no card is charged." The `sk_test_…` key shown is a hardcoded string never sent; the Test/Live toggle is client-side only; `DELETE` is selectable.
5. **Webhook retries and dunning retries never run.** `process_due_retries` has **no caller** — referenced only by its own docstring and tests. `charge.next_attempt_at` is written and never read. A customer endpoint 502s once and is retried never, while the deliveries screen shows a scheduled retry.
6. **Embed sessions are replayable and origin-unrestricted by default.** The route docstring claims a "single-use stamp"; `consumed_at` is set but never checked — verified the same token resolved 200 twice. And when `allowed_origins` is empty (the default for every new org) the origin check is skipped entirely, for up to 24h.
7. **`Organization.subscription_status` is an unsynchronized second copy of the truth** — never written by `billing_service`, but counted by `saas.py:34` and filtered by `tenants.py:84`. A cancelled tenant is correctly blocked by entitlements while the platform dashboard keeps counting them as paying.
8. **The default inbound-webhook secret is a shipped constant.** Signature verification itself is correct and constant-time, but with `BILLING_WEBHOOK_SECRET` unset, anyone who has read this repo can sign `{"type":"subscription.activated","plan_code":"enterprise"}` and grant themselves the top plan permanently. No startup assertion.
9. **SSRF guard disabled when `ENVIRONMENT` is `development` or `test`.** Verified: `http://127.0.0.1:9/hook` accepted (201). Production logic is correct and thorough; the risk is a misconfigured environment name.
10. **The public API is read-only, undocumented-as-built, and unthrottled.** Six read routes under `/api/v1`; the scopes `contacts:write`, `documents:write` and `envelopes:send` are grantable but unlock nothing. `lib/sf/data.ts:502-519` documents endpoints and query params that do not exist.
11. **`ApiScreen` presents fabricated operations data next to real controls** — three fake webhook endpoints with fake health, three fake OAuth apps, and five hardcoded usage bars, under a comment claiming "Awaiting webhook-endpoint CRUD" when the backend has **complete** CRUD, rotate-secret, delivery log, replay and test-send.

**Genuinely production-quality here:** the entitlement resolution engine with machine-readable 402 bodies; API-key hashing, one-time secret exposure, scope enforcement and `/api/v1` tenant isolation (all probe-verified); inbound provider-webhook signature verification and idempotency with `IntegrityError` race handling; and the outbound webhook signing/backoff/after-commit design.

---

## 8. Frontend

The data layer is in better shape than expected: **14 of 20 screens are genuinely server-rendered** through `serverCaller` → `resources` → `adapters`, and **`adapters.ts` never fabricates a value** — the full `FALLBACK:` inventory degrades to `—`, `0`, or a documented substitute, and comments say so. The dishonesty is concentrated in five places.

### Per-screen verdict

**LIVE (14):** TenantHome, Library, Routing, Audit, Reports, Billing, Invoices, Sandbox (real calls — but see §7.4), Logs, PlatformHome, Revenue, Support, SignSurface/SignGate, Shell's page data.
**PARTIAL (6):** Builder (fake canvas), Signer (fake paper + invented dropdown options), Contacts (fake per-contact history), ApiScreen (OAuth/webhooks/quota panels), Platform (fake usage bars), Shell/Modals (notification tray, badges, saved signatures).
**DEMO (2):** AccountArea (9 of 11 sections), Guides (legitimately static documentation).

### Hardcoded data presented as the user's own

| Location | What's faked | Impact |
|---|---|---|
| `Builder.tsx:437-445` | The entire document canvas | Fields placed on content that isn't the document (C2) |
| `Signer.tsx:225-230` | "MASTER SERVICES AGREEMENT — SIGNATURE PAGE" on every page | Signers attest to boilerplate (C2) |
| `AccountArea.tsx:121` | **Account audit log** — 8 events with fabricated IPs and checksums | A security surface showing invented evidence |
| `AccountArea.tsx:85` | Authenticated devices with invented IPs and cities | A user reviewing sessions for compromise sees fiction; "Sign out" is a toast |
| `AccountArea.tsx:97-116` | Salesforce "Connected · 2-way sync", Slack, Zapier, teams, orgs, quotas | Every connector reads as connected |
| `AccountArea.tsx:209,290` | Literal `priya@acme.io` as the signed-in user's email | The profile shows someone else's identity |
| `Shell.tsx:179-184` | Notification tray on **every** authenticated page — including a fake payment failure and escalation | Persistent fake alerts behind a "5 new" badge |
| `Shell.tsx:201` | Org switcher hardcoded to "Acme Corporation" | Every tenant sees Acme as its workspace name |
| `ApiScreen.tsx:137-166` | OAuth apps, webhook endpoints, plan-usage bars | Upgrade decisions made on invented meters |
| `Platform.tsx:329` | Platform-wide metered usage | Super-admin reads capacity off constants |
| `Contacts.tsx:31-36` | Identical invented signing history for **every** contact | — |
| `Modals.tsx:109,171` | Send-confirmation envelope ref and page count; "saved signatures" | The final confirmation before an envelope leaves names the wrong envelope |

### Quality, state and accessibility

1. **MFA login is broken** (§3) — the app's highest-severity user-facing bug.
2. **No PDF rendering pipeline exists at all** (C2) — no worker config, no page-image path, no lazy-load strategy. Field coordinates are authored against an 816×1056 synthetic sheet, so wiring a real renderer must reconcile that scale (and C1's origin flip).
3. **No client-side 401 recovery.** `apiCall` returns `{kind:'unauthorized'}` correctly and **no client component anywhere branches on it**. After the 12h cookie expires, every mutation fails with a toast and no redirect. The *server* transport does this right.
4. **No timeouts, no retries.** No caller passes `init.signal`; there is no `AbortSignal.timeout()` anywhere. And when the backend is down, pages render a confident **"0 documents, $0 MRR, 100% uptime"** — indistinguishable from an empty workspace.
5. **Zero tests, zero CI.** vitest + jsdom + plugin-react installed, `vitest.config.ts` written, `npm test` wired, **no test files**. No `.github/`, so `tsc`, lint and `build` never run on a change. `tsconfig.tsbuildinfo` is committed.
6. **`outline: 'none'` 23 times with no `:focus-visible` replacement.** Every input in the app — login, the signing surface, the builder — is unusable-by-sight for keyboard users. WCAG 2.4.7 failure product-wide, and the cheapest fix in this report.
7. **Modals have correct ARIA and no modal behaviour** — no focus move, no trap, **no Escape handler**, no focus restoration, background not inert.
8. **Builder field placement has no keyboard path** — palette buttons bind only `onPointerDown`. Once a field exists, keyboard handling is good (arrows nudge 1px, Shift 8px, Delete, Cmd+D). The gap is creation only.
9. **Login is not a `<form>`** — Enter does not submit on the highest-traffic screen, and password managers get no submit event. The store ships `authEmail: 'priya@acme.io'` as the prefilled default.
10. **Contrast fails throughout** — `#94a3b8` on white (~2.6:1) used 78 times.
11. **The Zustand store is 562 lines mixing UI state, server state and prototype seed data.** Its filter selectors are dead code, but `Shell.tsx` still reads `s.contacts`/`s.tickets` from the seed — deleting the prototype data would break the sidebar today.
12. **Tailwind is configured, tokenised, and completely unused.** `className` appears **0 times**; `style={{` appears **1,103 times**. `tailwind.config.ts` builds on `app/tokens.css` — **a file that does not exist** — and `globals.css` has no `@tailwind` directives. Hence no dark mode, no theming, no pseudo-states (the cause of finding 6), no breakpoints.
13. **Route-boundary coverage is inconsistent** — the four `/documents/[id]/*` segments are excellent; `/overview`, `/reports`, `/billing`, `/contacts`, `/support`, `/developer/*` and all seven `/platform/*` routes have no segment `loading.tsx`, and `/platform/*` has no `error.tsx`. `Suspense` is used twice, both as bare `useSearchParams` wrappers — no streaming, so `/platform/tenants` blocks on the slowest of eleven parallel calls.
14. **`Tour.tsx` positions its spotlight at absolute pixel coordinates** from the prototype's 1440px layout — on any other viewport it highlights empty space.

---

## 9. Production Readiness, Security & Operations

### Migrations & data integrity

1. **[CRITICAL] `0001_initial` is `Base.metadata.create_all` (C10).** The "initial schema" is whatever the models are *today*. Consequences: drift detection is vacuous (`compare_metadata()` returned zero diffs — meaninglessly); revisions 2–13 are dead code on a fresh DB, surviving only via 5–20 existence guards each; two DBs bootstrapped at different commits get different schemas while reporting the same `alembic_version`.
2. **[HIGH] Nothing runs `alembic upgrade`** — a fresh `docker compose up` points at an empty database.
3. **[MEDIUM] The chain is linear (verified, 13 revisions, no branches)** but downgrades are lossy — `d2f4a2b6c702` admits "PostgreSQL cannot remove enum members".
4. **[HIGH] 25 foreign keys have no index.** Measured against `pg_catalog`. Hot ones: `documents.owner_user_id`, `notifications.organization_id`, `feature_flag_overrides.organization_id`, `team_members.user_id`, and `folders.parent_id` (recursive tree walks → table scan per level). Root cause: **4 `index=True` declarations across 76 `ForeignKey()` columns**.
5. **[HIGH] All 76 FKs are `ON DELETE NO ACTION`; cascade is ORM-only.** Verified `confdeltype = 'a'` for all 76, while 14 relationships declare `cascade="all, delete-orphan"`. Any bulk/raw delete fails on FK violation, and deleting an org must load every child row into memory.
6. **[HIGH] N+1 in every list endpoint — there is not one eager load in the backend.** `grep joinedload|selectinload|subqueryload` → one hit, a model default. A 200-document library page issues 201 queries.
7. **[MEDIUM]** `list_documents`/`list_templates` are unpaginated; the connection pool is entirely unconfigured; soft delete exists on `documents` only.

### Secrets & cryptography

8. **[CRITICAL] `JWT_SECRET` default with no guard (C5)** — the guard pattern already exists in `crypto.py:73` and simply isn't applied.
9. **[HIGH] `SECRET_ENCRYPTION_KEY` silently derives from `JWT_SECRET` outside production.** The check is an exact string match on `"production"` — `staging`, `prod`, `production-eu` or unset all get a key derived from a default secret, and will encrypt real tenant SMTP/Twilio credentials with it.
10. **[MEDIUM] Key rotation is half-built** — rotation is lazy, so a row never rewritten keeps old-key ciphertext forever. Worse, `process_result_value` swallows **all** decrypt failures and returns `None`, so a mis-rotation silently turns every tenant's SMTP password into `None` and outbound email quietly stops.
11. **[LOW] Token entropy is uniformly sound — no findings.** Every security token is CSPRNG; `import random` appears nowhere; opaque tokens are stored SHA-256-hashed. **This is the strongest area of the codebase.**
12. **[MEDIUM]** bcrypt rounds unpinned, `bcrypt==4.0.1` stale, no max password length.

### Security hardening

13. **[CRITICAL] Session revocation, user status and org suspension are all unchecked in `get_current_user` (C4).**
14. **[HIGH] No security headers anywhere.** `next.config.ts` is three lines — no HSTS, CSP, `X-Frame-Options`, `nosniff` or `Referrer-Policy`. **With no `frame-ancestors`, the signing page can be framed and clickjacked into producing a signature.**
15. **[HIGH] CORS `allow_credentials=True` with an unvalidated origin list** — an empty `CORS_ORIGINS` yields `[""]`, and nothing prevents `*`.
16. **[MEDIUM] CSRF rests entirely on `SameSite=Lax` with no token**, and `secure` is keyed on `NODE_ENV` — so a staging deploy built in dev mode ships a non-Secure session cookie.
17. **[MEDIUM] Webhook SSRF protection is TOCTOU-vulnerable.** Validation is genuinely well built (scheme allowlist, IP-literal blocking, `getaddrinfo` over every resolved address, `follow_redirects=False`) — but it runs at **creation** time and delivery re-resolves DNS independently. A rebinding host reaches `169.254.169.254` on every retry.
18. **[LOW→MEDIUM] File upload validation is good and path handling is excellent** — magic-byte check, `limit+1` read, and a proper `normalize_key` traversal defence re-checked after resolution. Residual: no scan for active PDF content (embedded JS, `/Launch`), and a tenant-controlled `filename=` on `FileResponse`.
19. **[LOW] Error responses barely leak; PII in logs is well controlled** — `redact_path` replaces signing/invitation/embed tokens, and bodies/headers/query strings are never stored.

### Observability

20. **[HIGH] `/api/health` returns `{"status":"ok"}` unconditionally** — no DB check, no storage check, no migration-version check, and no liveness/readiness split. An orchestrator will route traffic to a replica whose database is unreachable.
21. **[HIGH] No metrics, no tracing, no error sink.** `grep prometheus|opentelemetry|sentry|/metrics` → one hit, and it's a *business* metrics endpoint. **What on-call has during an incident: JSON lines on stdout, and a `system_logs` table reachable only through the API that is presumably broken.**
22. **[MEDIUM] Structured logging is the best-built subsystem here** — real JSON formatter, contextvar binding, `X-Request-ID` echoed, uvicorn folded in, and a subtle correctness fix explicitly clearing the org contextvar so a recycled task cannot leak one tenant's id into another's logs. Two gaps: the Next proxy **drops `x-request-id`**, so browser→backend correlation is impossible; and webhook deliveries carry no request id.
23. **[MEDIUM] `system_logs` grows forever** — the model comment names the missing retention job. Simultaneously a disk problem and a GDPR problem.
24. **[MEDIUM] Every mutating request pays two extra synchronous queries** — `persist_request_log` opens a new session, does a `db.get(User, …)`, inserts and commits on the response path, doubling connection pressure exactly when the pool is tight.

### Reliability at scale — what breaks at 2+ replicas

| Component | Failure |
|---|---|
| Rate limiter (`InMemoryRateLimitBackend`) | Every limit multiplies by N — login, OTP send, password reset. **An authentication-strength regression, not just a scaling bug.** |
| OTP lockout | Same multiplication, on the signer identity path |
| Webhook daemon threads | Die on SIGTERM with no drain; at-least-once degrades to at-most-once |
| Local file storage (the default) | Replica A stores a PDF; replica B 404s. `FileResponse(storage.path(…))` is fundamentally single-node — `S3Storage` exists and is unused |
| Crypto keyring `@lru_cache` | Rotation needs a full restart; mid-rollout replicas disagree |
| Connection pool (unconfigured) | 3 replicas × 4 workers × 15 = **180 connections against a default `max_connections=100` — the deployment fails to start** |

25. **[HIGH] Neither cron script is scheduled**, so webhook retries and document expiry are silently dead in production. For e-signature software, "the expiry sweep is not running" means signing links stay live past their stated expiry.
26. **[MEDIUM] No graceful shutdown** — no SIGTERM handler, deprecated `on_event` with no shutdown, non-joinable delivery threads.
27. **[LOW] 2469 warnings are latent breakage** — 15 `datetime.utcnow()` sites returning *naive* datetimes against `DateTime(timezone=True)` columns. `webhook_service._aware()` is a symptom. Mixing naive and aware datetimes in expiry comparisons is exactly how signing tokens silently mis-expire.

### Deployment

28. **[CRITICAL] Both Dockerfiles are dev images (C11).** Frontend: `npm install` not `npm ci`, no `next build`, `CMD npm run dev`, root. Backend: `build-essential` retained in the final image, single uvicorn process, root, no `HEALTHCHECK`, no migration step.
29. **[HIGH] No CI whatsoever.** 271 passing tests run only when someone remembers.
30. **[HIGH] No backup or restore story.** Plain local volumes; no `pg_dump` schedule, no PITR, no uploads replication, **no restore drill**. The uploads volume holds the executed documents — losing it destroys the evidentiary artifacts the audit trail refers to.
31. **[LOW] Secret hygiene in git is clean** — only `.env.example` files are tracked.

### Compliance

32. **[HIGH] Audit rows are deletable by ORM cascade** — purging a document destroys the trail ESIGN/UETA and eIDAS require you to retain. No append-only enforcement at the DB level.
33. **[MEDIUM] ESIGN/UETA posture is partially built.** Present and good: intent/consent capture, OTP identity, IP+UA on audit rows, SHA-256 integrity, certificate of completion. Missing: the retention tiers in `plan.py` are **marketing strings** — no engine reads them; no legal hold; no cryptographic seal.
34. **[MEDIUM] eIDAS: this is Simple Electronic Signature only.** No qualified TSP, no certificate-based signing, no RFC 3161 timestamp. Legally sufficient for many uses — but `platform_service.py:82` hardcodes `{"name": "GDPR", "status": "certified"}`, asserting a certification the codebase does not substantiate.
35. **[HIGH] The GDPR-erasure vs immutable-audit tension is entirely unaddressed.** No erasure endpoint, no anonymization path, no subject data map — while PII sits in `audit_logs`, `system_logs`, `contacts`, `recipients` and `user_sessions`. The standard resolution, **crypto-shredding**, is directly buildable here because `EncryptedString` and the versioned keyring already exist.
36. **[MEDIUM] No data residency story** — one database, one bucket, one region.

### Dependencies

37. **[CRITICAL] `pypdf==5.1.0` — ~27 unpatched advisories, and it parses every uploaded PDF** (untrusted input from any user and any signer). Fix: `>=6.15.0`.
38. **[HIGH] `next@15.1.3` — 30 advisories, 1 critical**: RCE in the React flight protocol, and an **authorization bypass in Next.js middleware** — directly relevant, since `middleware.ts` is the app's route guard. Fix: `>=15.5.24`.
39. **[HIGH] `starlette==0.41.3` — 9 advisories**, pinned transitively by `fastapi==0.115.6`.
40. **[HIGH] `ecdsa==0.19.2` — PYSEC-2026-1325, no fix available**, pulled in by the long-unmaintained `python-jose`. Since only HS256 is used, **replacing `python-jose` with `PyJWT` drops it entirely.**
41. **[MEDIUM] Three competing package-manager sources of truth in `frontend/`** — `package-lock.json`, `pnpm-lock.yaml` **and** `pnpm-workspace.yaml`. The Dockerfile builds from npm while the pnpm lockfile is newer: **the image is built from a different dependency graph than local development resolves.**

---

## 10. What Is Genuinely Production-Grade

Worth protecting during remediation — these should not be rewritten:

- **Token generation and storage.** Uniformly CSPRNG, uniformly hashed at rest. No findings.
- **Tenant data isolation.** 40+ probes clean across every resource.
- **The entitlement engine.** Real enforcement with machine-readable 402 bodies and a shared limits/rows derivation.
- **API-key lifecycle.** Hashed, shown once, scope-enforced on `/api/v1`, tenant-scoped on every query.
- **Inbound webhook verification.** Constant-time HMAC with idempotency and `IntegrityError` race handling.
- **Outbound webhook design.** Canonical serialization, HMAC over `{ts}.{body}`, DB-backed retry state that survives restart, exponential backoff, after-commit dispatch that never breaks signing. It needs a scheduler, not a rewrite.
- **Structured logging.** Including the contextvar-clearing fix that prevents cross-tenant id leakage.
- **Upload validation and path handling.** Magic bytes, bounded reads, and a correct traversal defence.
- **`adapters.ts`.** Degrades to `—` rather than inventing values, and documents every fallback.
- **The backend test suite.** 271 tests, genuinely exercising multi-tenancy, entitlements, rate limits, webhooks and OTP.

---

## 11. Remediation Roadmap

### Phase 0 — Stop-the-bleeding (before any demo to a customer)

Removing false claims costs almost nothing and eliminates the reputational and legal exposure of the demo surfaces:

1. Delete or clearly label the fabricated UI: the account audit log and device list, the notification tray, the OAuth/webhook/quota panels, the platform usage bars, the contact history, and the `flash()`-only controls (payout, step-up MFA, CSAT, undo/redo, ten library actions).
2. Remove the `powered by Stripe · PCI DSS L1` claim and disable the card form until a real tokenizer exists.
3. Remove the hardcoded SOC 2 / HIPAA / GDPR `certified` badges.
4. Relabel or remove the `Sandbox` screen — it writes to the live tenant.

### Phase 1 — Correctness blockers

5. **Fix the coordinate origin flip** and derive page geometry from the real mediabox rather than a hardcoded 816×1056. Add a round-trip test asserting an authored position lands at the matching PDF coordinate. (C1)
6. **Wire a real PDF renderer** into the builder and the signing surface, reconciling the synthetic-sheet scale. (C2)
7. **Fix the auth vulnerabilities**: validate the `purpose` claim; check `sid` → `revoked_at`, user status and org suspension in `get_current_user`; cut access-token life to ~15 min; add the `JWT_SECRET` production guard using the pattern already in `crypto.py`. (C3, C4, C5)
8. **Persist `chain_head`** on append, anchor it in the certificate, make `verify_chain` refuse to report valid without a stored head, and stop cascading audit rows on purge. (C6)
9. **Fix the signer session** to return only assigned fields. (§5.1)
10. **Fix the MFA login branch and the MFA/forgot/reset/invite forms**, and add the missing `/reset-password` and `/invite/[token]` routes. (§3)
11. **Fix the conditional-required deadlock, initials fields, and dropdown option validation.** (§4.3–4.5)
12. **Upgrade `pypdf`, `next`, FastAPI/Starlette; replace `python-jose` with `PyJWT`.** (C9)

### Phase 2 — Commercial and operational viability

13. Implement a real payment provider behind the existing `PaymentProvider` seam; build invoice generation and a renewal/period-close job; gate `change-plan` on payment. (C7)
14. Apply `check_entitlement` to `api_access`, `webhooks`, `custom_branding` and storage. (§7.2)
15. Enforce impersonation scopes, add a token denylist keyed on the `token_hash` already stored, and attribute impersonated actions via the `imp` claim. Enforce tenant suspension. Audit the three unaudited mutations. (C8, §6.4–6.5)
16. Rewrite `0001_initial` as explicit DDL; add `alembic upgrade head` to the deploy path under an advisory lock; add the CI drift assertion. (C10)
17. Replace both Dockerfiles with multi-stage non-root builds. (C11)
18. Move the rate limiter to Redis via the `RateLimitBackend` Protocol that already exists; make S3 the storage default; schedule `process_due_retries`, `run_expiry.py` and a new `system_logs` retention job.
19. Add the readiness endpoint, configure the connection pool, add security headers, validate the CORS list.
20. Index the 25 unindexed FKs; add DB-level `ON DELETE` matching the ORM cascades; add eager loading and pagination to list endpoints.
21. Set up backups with PITR and **rehearse a restore**.

### Phase 3 — Test and CI foundation (start in parallel with Phase 1)

Twelve tests, ordered by the real bug each catches — several fail today by design, which is the point:

1. `SignInForm` MFA challenge routing (catches the `router.replace(undefined)` dead end)
2. `MfaForm` code exchange (asserts it calls the endpoint rather than flashing)
3. `SignInForm` failure paths (401 and network → correct `role="alert"` copy)
4. `apiCall` 401 → login redirect
5. `requestJson` error mapping, table-driven across 401/403/404/409/422/500/network
6. Library filter round-trip: query → params → query
7. Adapters return empty states, never invented values — assert no `data.ts` string appears in output
8. **Screen-level static-data guard**: render all 20 screens with empty props, assert the DOM contains none of `ENV-2291-KD`, `acme.io`, `Alex Rivera`, `4.1M of 10M`, `Northwind Analytics`. *Fails on ~9 screens today — that failure list is the regression net for Phase 0.*
9. Signing surface renders the real document (guards C2 permanently)
10. Builder keyboard field placement (fails today at the first step)
11. Modal focus management — trap, Escape, restoration
12. Backend-down degradation shows an explicit error, not a confident `0`

Plus a **field-coordinate round-trip test** (C1) and **cross-org isolation tests** for the eleven resources `test_tenancy.py` does not cover.

**CI** (`.github/workflows/ci.yml`, on push and PR): backend — pytest, `alembic upgrade head` against ephemeral Postgres with a `compare_metadata()` emptiness assertion, `pip-audit`; frontend — `npm ci`, `tsc --noEmit`, lint, `vitest run --coverage`, `next build`, `npm audit`. Make it a required check with a coverage floor on `lib/api/` and `lib/sf/adapters.ts`. Add `frontend/tsconfig.tsbuildinfo` to `.gitignore` and `git rm --cached` it.

### Phase 4 — Compliance and scale

22. Re-validate webhook URLs at delivery and pin to the validated IP.
23. GDPR erasure via crypto-shredding on the existing keyring; document the Art. 17(3) retention exemption.
24. Implement retention tiers and legal hold as enforcement; add RFC 3161 timestamping and PAdES sealing.
25. Metrics, tracing with request-id propagation through the Next proxy, and an error sink.
26. Migrate `on_event`→`lifespan`, purge `datetime.utcnow()`, drain webhook threads on SIGTERM.
27. Adopt Tailwind (the config exists; `app/tokens.css` does not) and fix the focus-visible and contrast failures.

---

## 12. Method & Limitations

**Method.** Seven agents audited in parallel: authentication, document lifecycle, signer journey, platform operations, billing/developer platform, frontend, and production readiness. Each backend claim was verified by driving the real application through FastAPI `TestClient` using the project's own `conftest.py` fixtures — registering organizations, uploading `sample.pdf`, sending envelopes, signing them, and then attacking the result (cross-org probes, token replay, scope escalation, DB-level tampering). The production-readiness agent additionally stood up a throwaway Postgres 16 container, ran the full Alembic chain, and queried `pg_catalog` directly for index and cascade coverage; `pip-audit` and `npm audit` were run for real. Nothing in the repository was modified; all scratch scripts were written to a temporary directory.

**Limitations.**
- Runtime behaviour under concurrency and load was not measured — the scale findings are derived from code and configuration, not from a load test.
- The frontend was audited by source inspection and type-checking; no browser was driven, so visual regressions, real mobile rendering, and screen-reader behaviour are assessed from markup rather than observed.
- Accessibility findings are a spot-check of the highest-stakes flows, not a full WCAG audit.
- Dependency advisories reflect the audit date; re-run before acting.
- `compare_metadata()` reported zero migration drift, but as finding §9.1 explains, **that result is not evidence of correctness** — it is an artifact of `0001_initial` calling `create_all`. Real drift cannot be measured until that is fixed.
