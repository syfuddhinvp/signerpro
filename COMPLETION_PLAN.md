# SignForge — Completion Plan

**Date:** 3 September 2026 · **Branch:** `fix/audit-remediation` · **Base commit:** `8d3316e`
**Purpose:** the single sequenced path from where the tree actually is today to a shippable v1.
Companion docs: `AUDIT_REPORT.md` (what was wrong), `REMEDIATION.md` (what was fixed),
`DECISIONS.md` (the standing decisions that let this be executed without stopping to ask).

---

## 1. Verified state — measured today, not claimed

Every row below was re-run against the working tree on this machine, not copied from `REMEDIATION.md`.

| Gate | Result | Command |
|---|---|---|
| Backend tests | **414 passed, 0 failed** (2m18s) | `backend/.venv/bin/python -m pytest -q` |
| Frontend tests | **640 passed** across 24 files (22s) | `pnpm vitest run` |
| Typecheck | **clean** | `npx tsc --noEmit` |
| Production build | **exit 0**, 102 kB shared First Load JS, middleware 36 kB | `pnpm build` |
| Python advisories | **0** | `pip_audit -r requirements.txt` |
| JS advisories (prod) | **0** | `pnpm audit --prod` |
| postcss override intact | **one version, 8.5.26** | `pnpm why postcss` |

All 11 ship-blocking findings in the audit's critical register (C1–C11) are closed and covered by
tests. The tree is in materially better shape than `REMEDIATION.md`'s own "known remaining work"
section describes — see §3.

### ~~The one urgent risk~~ — closed 4 September 2026

The remediation was uncommitted: 191 modified + 91 untracked files against `8d3316e`, existing only
as working-tree state on one machine. It is now committed as `bbeef27`, 295 files,
+27,035/−10,188, with `frontend/tsconfig.tsbuildinfo` untracked (it was ignored but still in the
index). The working tree is clean.

**Still outstanding:** the branch is not pushed. The commit protects against `git checkout .`; only a
push protects against losing the machine.

### 1b. CI dry run — every job executed locally, 4 September 2026

CI had never run once; it was validated only by YAML parse. Each job step in
`.github/workflows/ci.yml` has now been executed on this machine against CI-equivalent inputs.

| CI step | Result |
|---|---|
| `pytest -q` | 414 passed |
| `alembic upgrade head` → **empty postgres:16-alpine** | 15 revisions applied, exit 0 |
| Re-apply migrations (must be a no-op) | exit 0, no revisions run |
| `scripts.check_schema_drift` | **`schema drift: none`** |
| `pip-audit --requirement requirements.txt --strict` | no known vulnerabilities |
| `packageManager` field (pnpm/action-setup@v4 needs it) | present, `pnpm@11.21.0` |
| Reject competing lockfiles | none present |
| `pnpm-workspace.yaml` present (carries security overrides) | present |
| `pnpm install --frozen-lockfile` | exit 0 — lockfile and package.json agree |
| `npx tsc --noEmit` | clean |
| Lint | no ESLint config → step warns and skips (see W19) |
| `npx vitest run --coverage` | 640 passed, coverage floors met |
| `pnpm build` | exit 0 |
| `pnpm audit --prod --audit-level high` | 0 |
| `docker compose -f docker-compose.yml config -q` | OK |
| `docker compose -f docker-compose.prod.yml config -q` against `.env.prod.example` | OK — the example env is complete |
| Build backend image (`--target runtime`) | exit 0, **429 MB** |
| Build frontend image | exit 0, **325 MB** |

Two things this bought beyond confidence: the C10 fix is now proven against **real PostgreSQL**
rather than the test suite's SQLite — 15 revisions apply to an empty database, re-apply as a no-op,
and diff clean against `Base.metadata` — and `.env.prod.example` is confirmed complete, which is the
check that otherwise fails at deploy time rather than in CI.

**W19 (new, P3):** there is no ESLint configuration, so CI's lint step warns and skips by design.
Add `eslint.config.mjs` with `eslint-config-next` to turn it on.

---

## 2. Definition of done for v1

v1 ships when all of the following are simultaneously true:

1. Every gate in §1 is green **in GitHub Actions**, not just locally (CI has still never actually run).
2. The production stack (`docker-compose.prod.yml`) comes up from an empty Postgres, migrates under
   the advisory lock, and serves a full sender→signer→executed-PDF round trip.
3. The four scheduled jobs run on a real schedule: billing cycle, envelope expiry, log retention,
   webhook retry. Without the billing cycle, no invoice is ever issued.
4. No screen presents fabricated data as the user's own, and no control is a `flash()` toast where a
   working endpoint exists.
5. Marketing/product copy claims only Simple Electronic Signature — never AdES/QES, never PCI, never
   an unbuilt compliance certification.
6. The remaining product gaps in §3 are each either built, or honestly labelled in-app and recorded
   here as deferred. Silence is not an option; a gap is closed or it is disclosed.

---

## 3. Remaining work register

Re-derived from the source today. Items `REMEDIATION.md` still lists that are in fact already
resolved are marked **stale** — the docs are behind the code.

### P0 — Do first, blocks everything

| # | Item | Why | Size |
|---|---|---|---|
| ~~W1~~ | ~~Commit the remediation~~ | **Done** — `bbeef27`, tree clean | ✅ |
| **W1b** | Push to `origin` and `signerpro` | Committed but unpushed; one machine still holds it | 5 min |
| **W2** | Make CI actually run | Every job now dry-run locally (§1b); the remaining unknown is runner-specific, not repo-specific | 1 h |

### P1 — Blocks a real deployment

| # | Item | Evidence | Size |
|---|---|---|---|
| **W3** | Stand the prod stack up end to end and record the run | `docker-compose.prod.yml` untracked, never exercised as a whole in this environment | 3–5 h |
| **W4** | Schedule the four jobs (cron/`schedule` container/K8s CronJob) | `scripts/run_billing_cycle.py`, `run_log_retention.py` exist but nothing invokes them | 3 h |
| **W5** | Coordinate data migration decision for pre-C1 field rows | Stored `y` is now read under a new origin; a deployment with real data needs an explicit call | 2 h (see `DECISIONS.md` D4) |
| **W6** | `set_default_payment_method` is a no-op on the Stripe adapter | `billing_service.py:954` — ABC signature doesn't carry the customer id | 2–3 h |
| **W7** | Access-token refresh race | 15-min tokens, 30s skew, backend rotation revokes on first use; concurrent refreshes race | 2 h — add a short backend tolerance window |
| **W8** | Deployment preconditions are tribal knowledge | `SESSION_JWT_SECRET` must equal backend `JWT_SECRET`; `BILLING_PROVIDER=null` is rejected; `EMBED_FRAME_ANCESTORS` is a **build arg**, not runtime env | 1 h — fold into a `DEPLOYMENT.md` and a preflight script |

### P2 — Product completeness

| # | Item | State | Size |
|---|---|---|---|
| **W9** | Silent degradation in server pages | 26 files still use `.ok ? data : FALLBACK`; `ApiUnavailable` is the drop-in but each needs a judgement about whether that call is load-bearing | 4–6 h |
| **W10** | `formula` fields | Retired honestly in the palette (`data.ts:53` "Formula (retired)"), nothing evaluates them | Build (2–3 d) or keep retired — `DECISIONS.md` D2 |
| **W11** | GDPR erasure | Designed on the existing keyring (crypto-shredding), not built. Retention tiers are plan copy, not enforcement | 3–4 d |
| **W12** | Public verification endpoint | Absent; the audit QR block stays removed until it exists | 1–2 d |
| **W13** | SSO/SAML, WebAuthn passkeys | Not built. Fake buttons already removed — the honest state | Enterprise-gated, defer (D3) |
| **W14** | PAdES/PKCS#7 sealing | Not built. Constrains what may be claimed (see DoD #5) | Defer (D3) |

### P3 — Carried debt, non-blocking

| # | Item | Note |
|---|---|---|
| **W15** | Tailwind `@tailwind base` deliberately omitted | `globals.css:7` — ~1,100 inline-styled sites; four-step migration documented in the file itself |
| **W16** | Test warnings | 571 remaining (down from 2,469) |
| **W17** | 12 unindexed FKs | Remainder justified inline |

### Stale in `REMEDIATION.md` — already fixed, docs lag

- `stamp` **is** type-aware in the final PDF (`pdf_service.py:247`).
- Certificate of completion **is** exportable (`GET /api/documents/{id}/certificate/...`, `audit.py:98`).
- `recipsOf()` in `state.tsx` no longer exists; that file is gone.

**Action W18:** rewrite `REMEDIATION.md`'s "Known remaining work" to match §3, and fold the
long-superseded `PROJECT_PROGRESS.md` (still describes a 7-test prototype) into this document.

---

## 4. Sequence

```
Phase 0  W1 ✅ → W1b → W2           commit, push, green CI          ½ day
Phase 1  W3, W4, W8 ∥ W5, W6, W7  deployable and billable          3 days
Phase 2  W9 → W18, W12            honest UI, verifiable audit      1 week
Phase 3  W11 ∥ W10                compliance and field completeness 1–2 weeks
Deferred W13, W14, W15, W16, W17  gated on demand, disclosed not hidden
```

Phase 1's two columns are independent and can run in parallel. Nothing in Phase 2 may start before
Phase 0 completes — every hour of Phase 2 work on an uncommitted tree compounds W1's risk.

---

## 5. Verification gate — run before declaring any phase complete

```bash
# backend
backend/.venv/bin/python -m pytest -q                 # expect 414+ passed, 0 failed
backend/.venv/bin/python -m pip_audit -r backend/requirements.txt   # expect 0

# frontend
cd frontend && npx tsc --noEmit                       # expect clean
pnpm vitest run                                       # expect 640+ passed
pnpm build                                            # expect exit 0
pnpm audit --prod                                     # expect 0
pnpm why postcss                                      # MUST report exactly one version
```

A phase is not complete until every line above passes and the phase's own acceptance evidence is
recorded in this file. "The tests probably still pass" is not evidence — the C1 mirroring bug and
the `Modals.tsx` conditional-hooks crash both survived a typecheck and seven read-only auditors.
Only execution catches this class of defect.
