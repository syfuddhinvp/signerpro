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

### 2.5 CORS

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

## 5. Known operational limits

- `RATE_LIMIT_BACKEND=memory` is per-process. With more than one backend replica, the limits are
  effectively multiplied by the replica count — switch to `redis` (and the `redis` profile).
- `STORAGE_BACKEND=local` stores uploads on the `signforge-uploads` volume, which is **not shared
  between hosts**. Multi-host deployment needs object storage behind the existing abstraction.
- Access tokens are 15 minutes and the frontend refreshes on a 30s skew. Concurrent refreshes can
  race, because backend rotation revokes on first use (`COMPLETION_PLAN.md` W7).
