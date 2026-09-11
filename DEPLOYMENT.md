# Deploying SignForge

Everything in this file is a failure that is otherwise **silent, delayed, or actively misleading** —
a stack that comes up healthy and is wrong. It exists because these preconditions were previously
tribal knowledge scattered across `REMEDIATION.md`'s footnotes.

Run `scripts/preflight.sh .env.prod` before every deploy. It mechanises §2.

---

## 1. What the stack is

`docker-compose.prod.yml` brings up seven services: `postgres`, `backend`, `frontend`, and the four
schedulers — `expiry-scheduler`, `webhook-retry-scheduler`, `billing-cycle-scheduler`,
`log-retention-scheduler`. Redis is behind the `redis` profile (`--profile redis`) and is only
needed when `RATE_LIMIT_BACKEND=redis`.

**No reverse proxy is included, deliberately.** Terminate TLS at your ingress and route `/` to the
frontend and `/api` to the backend. Neither app container should face the internet directly.

**HTTPS is not optional.** Session cookies are `Secure`; over plain HTTP the browser never sends
them and every login appears to silently fail.

### Migrations

Only the API containers migrate, under a Postgres advisory lock, so concurrent replicas are safe.
Every scheduler runs `RUN_MIGRATIONS=0` and waits on `backend: service_healthy` — the readiness
probe — so none of them touches the database before it is at head.

Proven on an empty `postgres:16-alpine`: 15 revisions apply, a second run is a no-op, and
`scripts.check_schema_drift` reports `schema drift: none`.

---

## 2. Preconditions that bite

### 2.1 `JWT_SECRET` is shared with the Next server

The Next server verifies the session cookie's HS256 signature with **the same secret the backend
signs with** (`frontend/lib/auth/verify.ts`). Without it, verification returns `unverified`, and
every privilege decision is refused — the stack comes up healthy and **no platform admin can reach
`/platform`**.

`docker-compose.prod.yml` now derives the frontend's `SESSION_JWT_SECRET` from `JWT_SECRET`
directly, rather than exposing a second variable, because the two must never diverge. If you deploy
the frontend outside this compose file, you must set `SESSION_JWT_SECRET` yourself.

`ALLOW_UNVERIFIED_PLATFORM_ACCESS=true` is a **local-development escape hatch only**. Setting it in
production restores exactly the forged-cookie platform-admin bypass the audit found.

### 2.2 Build-time values cannot be set at runtime

`next.config.ts#headers()` runs during `next build`, so the CSP is baked into
`.next/routes-manifest.json`. These are **build args**, and changing one requires rebuilding the
frontend image — setting them under `environment:` looks like it worked and does not:

- `EMBED_FRAME_ANCESTORS` — origins allowed to frame `/sign/*`. Empty means `frame-ancestors 'none'`.
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### 2.3 Billing must be real

`BILLING_PROVIDER=null` is **not deployable** — the startup guard rejects it and the backend
crashloops rather than run unbilled. Set `stripe` plus `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`.

The `billing-cycle-scheduler` is what actually issues invoices and retries failed payments. Without
it running, **no invoice is ever issued** — the symptom is a system that looks fine for a month.

### 2.4 Secrets

`JWT_SECRET` and `SECRET_ENCRYPTION_KEY` must be ≥32 characters and must not be the published
defaults; the backend hard-fails at startup in production if they are. Generate with
`openssl rand -base64 32`.

`SECRET_ENCRYPTION_KEY` is the keyring for encrypted columns. **Losing it makes the encrypted data
unrecoverable** — there is no fallback path. Back it up separately from the database, or a database
restore will not be a restore.

### 2.5 Trusted proxies — `TRUSTED_PROXY_IPS`

`X-Forwarded-For` is honoured **only** when the immediate peer is listed in
`TRUSTED_PROXY_IPS` (comma-separated IPs or CIDRs). Unset, the header is ignored entirely, because
any client can send it and every per-IP rate limit — login, forgot-password, OTP, signing links —
would otherwise be bypassable by rotating one header.

**Behind an ingress this must be set to the ingress's address range.** If it is not, every request
appears to come from the proxy, so all clients share a single rate-limit bucket and the audit trail
records the proxy's address instead of the signer's.

### 2.6 CORS

`CORS_ORIGINS` may not contain `*`. The API is credentialed and rejects a wildcard.

---

## 3. Deploy

```bash
cp .env.prod.example .env.prod     # then fill in every REQUIRED value
scripts/preflight.sh .env.prod     # must print "preflight passed"

docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml --env-file .env.prod ps   # all healthy
```

Then confirm the schedulers are actually alive — a dead scheduler is invisible in the UI:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  logs --tail=20 expiry-scheduler webhook-retry-scheduler \
                 billing-cycle-scheduler log-retention-scheduler
```

### First run

`backend/scripts/provision_stripe_plans.py` creates the Stripe products and prices matching the
plan table. Run it once, against the same Stripe account the keys belong to.

---

## 4. Upgrading

1. Build the new images.
2. `docker compose ... up -d backend` first — it migrates under the advisory lock.
3. Then the frontend and the schedulers.

Migrations are expand-only; there is no down-path rehearsed for production. Roll forward.

---

## 4b. Object storage (S3 / MinIO)

Executed PDFs and adopted signatures go through one abstraction (`app/core/storage.py`) with two
backends. The development stack runs **MinIO** on the S3 backend, so the code path exercised
locally is the one production uses — the switch to AWS is credentials and a bucket, not a code
change.

Development (`docker-compose.yml`) needs nothing: the `minio` service and a one-shot `minio-init`
that creates the bucket come up with the stack. The console is on <http://localhost:9003>
(`minioadmin` / `minioadmin`); the API is on host port 9002 because 9000/9001 are commonly taken.
Override with `MINIO_PORT` / `MINIO_CONSOLE_PORT`.

Production:

| Variable | AWS S3 | MinIO / R2 |
| --- | --- | --- |
| `STORAGE_BACKEND` | `s3` | `s3` |
| `S3_BUCKET`, `S3_REGION` | required | required |
| `S3_ENDPOINT_URL` | unset | the endpoint the API calls |
| `S3_PUBLIC_ENDPOINT_URL` | unset | the endpoint **browsers** reach, when it differs |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | unset — use an IAM role | required |
| `S3_SERVER_SIDE_ENCRYPTION` | `AES256` | empty, unless a KMS is configured |

Two things bite otherwise:

- **Presigned URLs are opened by the browser.** SigV4 signs the host, so a URL signed against an
  internal endpoint cannot be rewritten to a public one afterwards. `S3_PUBLIC_ENDPOINT_URL` makes
  the app sign against the public host to begin with.
- **MinIO rejects `ServerSideEncryption: AES256`** unless it has a KMS. Leave the variable empty
  there; keep `AES256` on AWS, where it is the default.

Leave `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` unset on AWS and attach an IAM role — boto3 picks
it up, and no long-lived key sits in the environment.

`/api/health/ready` covers storage: on the S3 backend it does a `head_bucket`, so a bad bucket or
bad credentials fail readiness instead of surfacing as a 500 on someone's first signature.

## 4c. Enabling signer payments (Stripe Connect)

This is a **separate, optional** feature from §2.3/§4 above (which bill *tenants* for their
SignForge subscription). Here a *signer* pays the *tenant* directly during signing — a deposit, an
invoice, a retainer — as a direct charge on the tenant's own Stripe account. The platform is never
in the money path and takes no cut. Unset, the feature is simply unavailable (409s); nothing else
breaks. It reuses `STRIPE_SECRET_KEY` from §2.3, so `BILLING_PROVIDER=stripe` must already be
configured.

### Step 1 — Activate Connect (Accounts v2) on the platform's Stripe account

Connected accounts here are created on **Accounts v2** (`POST /v2/core/accounts`,
`POST /v2/core/account_links`, `Stripe-Version: 2026-08-26.dahlia` — see `STRIPE_API_VERSION_V2` in
`stripe_connect_service.py`), not v1: Stripe no longer accepts new connected accounts through
`/v1/accounts` at all. Each account is created with the `merchant` configuration
(`configuration.merchant.capabilities.card_payments.requested = true`) and `dashboard: "full"`,
which gives the tenant their own real Stripe Dashboard — the v2 shape closest to what used to be
called a "Standard account". There is no account type to pick in the Dashboard; it is all in the
create call.

`dashboard: "full"` is not a free choice here. It is required by the `losses_collector: "stripe"`
setting below: Express-dashboard access **combined with** Stripe carrying negative balances is
still only a public preview, available on the `2026-08-26.preview` API version. Requesting that
pair on a GA version fails with a flat `This account configuration is not supported`, which is a
hard error to trace back to one word in the request. The alternatives are to pin this integration
to a preview API version, or to take negative-balance liability onto the platform — neither being
worth a more limited dashboard. As a bonus, the full Dashboard gives tenants refunds, disputes,
payouts and reporting UI we would otherwise have to build.

**A connected account's dashboard type is immutable.** Changing this value later does not migrate
existing accounts — each one has to be recreated — so settle it before tenants start connecting.

Most Connect platforms have Accounts v2 available already. If it is not, `_request_v2` surfaces
Stripe's own `accounts_v2_access_blocked` error with the message "Accounts v2 is not enabled for
this Stripe account" — turn it on under the platform's Connect settings before connecting a tenant.
Stripe also exposes a dashboard toggle, "Accounts v1 support"
(`dashboard.stripe.com/settings/features/feat_accounts_v1_support`) — treat this as a **legacy
stopgap only**, not the path to take: this integration is built against v2, and re-enabling v1
support does not change what this code sends.

Status reads did **not** move to v2: `refresh_status` still polls `GET /v1/accounts/{id}` and the
`account.updated` webhook payload is still v1-shaped, because Stripe accepts a v2-created account id
at the v1 read endpoint. Do not expect (or configure against) a v2 capability model on that sync
path — only account *creation* and the onboarding *link* are v2.

**Who pays and who is liable** is set explicitly at account creation, by
`defaults.responsibilities` in `stripe_connect_service.ensure_account`. Stripe *requires* both
values whenever the `merchant` configuration is requested — omitting them is a 400, not a default —
and we send:

| Field | Value | Effect |
| --- | --- | --- |
| `fees_collector` | `stripe` | Stripe bills its processing fees straight to the tenant's account. SignerPro collects nothing on a tenant's invoice, so there is no platform fee to account for or remit. |
| `losses_collector` | `stripe` | Stripe — **not** this platform — carries a negative balance when a tenant cannot cover a refund or a lost dispute. |

Setting either to `application` moves that burden onto the platform: `application` for
`losses_collector` in particular makes every tenant's chargeback your liability, on a transaction
you earn nothing from. Change these only as a deliberate commercial decision, and before tenants
start collecting money rather than after the first dispute. `test_stripe_connect_v2.py` asserts
both values, so a change here fails a test rather than surfacing as a surprise on a statement.

### Step 2 — Register the Connect webhook (separate from the billing one)

Two independent webhook endpoints exist in this app, each with its own Stripe Dashboard entry and
its own signing secret. Do not conflate them:

| Endpoint | Purpose | Events | Secret |
| --- | --- | --- | --- |
| existing billing endpoint (§2.3) | platform bills the tenant | subscription/invoice events | `STRIPE_WEBHOOK_SECRET` |
| `POST /api/webhooks/stripe/connect` | signer pays the tenant | `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

The three Connect events above are exactly what `app/api/routes/payments.py`'s
`stripe_connect_webhook` dispatches on (`payment_intent.*` to `signer_payment_service`,
`account.updated` to `stripe_connect_service`) — register no more and no less. In the Dashboard,
create this as a second endpoint pointed at `<APP_BASE_URL>/api/webhooks/stripe/connect`, select
those three events, and copy its own `whsec_...` signing secret into
`STRIPE_CONNECT_WEBHOOK_SECRET`. Locally: `stripe listen --forward-to
localhost:8000/api/webhooks/stripe/connect`.

Getting `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` crossed is the most likely
misconfiguration here: both are `whsec_...` strings that look identical at a glance, but each only
verifies its own endpoint's deliveries. Cross them and every Connect webhook fails signature
verification — Stripe shows the delivery as failed with no clue from this app's own logs pointing
at which secret is wrong.

### Step 3 — Environment variables

| Variable | Required? | What it is |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | yes (already required by §2.3) | shared with billing; same test/live key |
| `STRIPE_PUBLISHABLE_KEY` | yes, for signer payments | `pk_test_.../pk_live_...`, handed to the signing client over the API so it can mount Stripe Elements against the tenant's connected account. Safe in the browser by design — it can only tokenize a card, never charge or read anything. **Not** the same variable as the frontend's `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (that one is for the platform's own billing checkout and is baked into the frontend bundle at build time; this one is read server-side by the backend). |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | yes, for signer payments | see Step 2 |

**Test vs. live**: use `sk_test_.../pk_test_...` everywhere except a real production deployment. A
live secret key (`sk_live_...`) is refused at boot unless `ENVIRONMENT=production`
(`verify_stripe_key_is_safe_here`, `LiveStripeKeyOutsideProduction`) — deliberately, so a developer's
machine can never accidentally charge a real card. This check covers `STRIPE_SECRET_KEY`, which
`stripe_connect_service` also uses for its own requests; there is no second secret key to keep in
sync.

`STRIPE_PUBLISHABLE_KEY` and `STRIPE_CONNECT_WEBHOOK_SECRET` are not guarded at startup — leaving
them unset does not crash the process, it makes the feature 409 on first use
(`signer_payment_service._publishable_key`), which is deliberate: unlike billing, signer payments are
optional and a tenant who never touches them should not block a deploy.

### Step 4 — A tenant connects their own account

Each tenant connects separately, in-app, at **Settings → Payments** (`/account/payments`). This
starts Stripe's hosted onboarding for the account created in Step 1 and returns them to the same page
(`stripe_connect_service.create_onboarding_link`). The connection is not usable immediately: Stripe
reports the `merchant` configuration's `card_payments` capability as inactive until the tenant
finishes onboarding (identity, bank details, etc.), which this app still surfaces as
`charges_enabled=false`, and `require_payable_account` refuses to let that tenant send a document
carrying a payment field until `charges_enabled` is `true`. The Payments screen shows this status,
and `account.updated` webhooks (Step 2) keep it in sync without the tenant needing to reload.

A Stripe-side failure anywhere in this flow (a declined onboarding call, a malformed link request) no
longer surfaces as a raw 500: `StripeApiError` has its own exception handler in `app/main.py` that
maps a Stripe 4xx to the equivalent 4xx here and a Stripe 5xx/transport failure to a 502, so the
sender/tenant gets Stripe's own error message instead of a stack trace.

### Step 5 — Verify end to end, in Stripe test mode

1. Configure `STRIPE_SECRET_KEY`/`STRIPE_PUBLISHABLE_KEY` with test-mode keys and set
   `STRIPE_CONNECT_WEBHOOK_SECRET` (Step 2, `stripe listen` locally).
2. As a tenant, go to Settings → Payments and complete Stripe's test-mode hosted onboarding until
   the screen reports charges enabled.
3. Send an envelope with a payment field allocated to a signer.
4. Open the signing link as that signer and pay with Stripe's standard test card, `4242 4242 4242
   4242`, any future expiry, any CVC, any postal code.
5. Confirm the signer's Pay button turns to "paid" and the signature can be submitted. If webhooks
   are wired up, `payment_intent.succeeded` should also arrive at the Connect endpoint and settle the
   payment even before the signer's own poll (`refresh_payment`) does.
6. In the Stripe Dashboard, switch to the connected account (View test data → the tenant's
   `acct_...`) and confirm the charge landed there, not on the platform account — proof this is a
   direct charge with the tenant as merchant of record.

## 5. Known operational limits

- `RATE_LIMIT_BACKEND=memory` is per-process. With more than one backend replica, the limits are
  effectively multiplied by the replica count — switch to `redis` (and the `redis` profile).
- `STORAGE_BACKEND=local` stores uploads on the `signforge-uploads` volume, which is **not shared
  between hosts**. Multi-host deployment needs `STORAGE_BACKEND=s3` (see below).
- Access tokens are 15 minutes and the frontend refreshes on a 30s skew. Concurrent refreshes can
  race, because backend rotation revokes on first use (`COMPLETION_PLAN.md` W7).
