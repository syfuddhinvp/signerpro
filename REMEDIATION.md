# Remediation Report

Companion to `AUDIT_REPORT.md`. Branch `fix/audit-remediation`.
**176 files changed, +11,319 / −7,811, 66 new files.**

## Verified final state

| Check | Before | After |
|---|---|---|
| Backend tests | 271 | **384 passed, 0 failed** |
| Frontend tests | **0** (none existed) | **500 passed** across 12 files |
| `tsc --noEmit` | clean | clean |
| `next build` | succeeds | succeeds (51/51 pages) |
| `npm audit --omit=dev` | 4 (1 critical) | **0** |
| `pip-audit` | 65 across 5 packages | **0** |
| Migrations → empty Postgres | never run anywhere | 15 revisions, 2nd run 0-op, **no drift** |
| Prod stack | never stood up | comes up, migrates under advisory lock, all 4 schedulers run |
| Frontend image | 1.12 GB | **325 MB** |
| N+1 on a 200-doc library | 202 SELECTs | **3**, constant to 500 docs |
| Unindexed FKs | 25 | 12 (rest justified inline) |
| FK `ON DELETE NO ACTION` | 76 | **0** |
| Failing-contrast literals | 126 | **0** |
| Test warnings | 2469 | 571 |

## Critical register — all 11 closed

| # | Finding | Resolution |
|---|---|---|
| C1 | Final-PDF fields vertically mirrored | Canonical space is now PDF points, top-left origin, end to end; the single flip lives in `PdfService._pdf_y()`. Proven by round-trip test on Letter **and A4** (field authored `y=150` lands exactly 150 from the top on an 841.89pt page). |
| C2 | Real PDF never rendered | pdf.js wired into builder and signer (`react-pdf` removed — it pins a conflicting `pdfjs-dist`). Page geometry now comes from the mediabox. First Load JS went *down* (133→128 kB on `/sign`). |
| C3 | MFA challenge token = full bearer credential | Access tokens carry `purpose: "access"`; `get_current_user` rejects any other purpose by default. |
| C4 | Session revocation unenforced | One joined query rejects revoked/expired sessions, inactive users, and suspended orgs. |
| C5 | `JWT_SECRET` default, no guard | `is_production()` inverts the environment test; weak/default secrets hard-fail at startup. |
| C6 | Audit chain not tamper-evident | Checksums persisted at append via a `before_flush` listener; `verify_chain` detects modification, deletion, reordering, insertion and truncation. Audit rows now survive document purge. File hashes re-verified rather than trusted. |
| C7 | No billing | `change_plan` gates on payment (invoice → collect → *then* entitle). `issue_invoice` is now the only `Invoice(` constructor. Stripe provider behind the existing ABC, tested with zero network. |
| C8 | Impersonation scopes/revocation/attribution decorative | The session row, not the token, is the credential — re-read per request. Read scope blocks writes; a forbidden-prefix list blocks *durable* grants even for write scope. Actions attributed to the admin. |
| C9 | `pypdf`, `next` CVEs | Both upgraded, plus `fastapi`/Starlette, `PyJWT`, `python-multipart`, and four transitives the audit missed (incl. **pillow**, which decodes signer-supplied PNGs). `python-jose`/`ecdsa` removed entirely. |
| C10 | `0001_initial` was `create_all` | Now 1022 lines of literal DDL. Freezing it immediately caught a real bug: `EncryptedString(n)` self-widens, so the old rendering created columns 3× too wide. |
| C11 | Dev Dockerfiles in production | Multi-stage, non-root, standalone output, healthchecks, migration-on-deploy under a Postgres advisory lock. |

## Also closed

Tenant suspension (was cosmetic) · forged-cookie platform-admin bypass · MFA replay · password-less MFA disable · login timing oracle · co-signer field disclosure · conditional-required deadlock · dropdown/radio option validation · unsignable initials · attachment upload (end to end) · CC/approve recipient roles · envelope expiry · the three unenforced entitlements · storage quota · sequential-recipient bypass · unaudited privileged mutations · role-guard divergence · webhook DNS-rebinding · embed replay + origin default · `/api/v1` rate limiting · security headers (incl. `frame-ancestors`, closing signing-page clickjacking) · CORS validation · connection pooling · readiness endpoint · Redis rate-limit backend · `lifespan` + graceful shutdown · request-id propagation · log retention · **37 fabricated-data instances** · focus-visible, modal focus trap, contrast, keyboard field placement · route boundaries · CI from nothing.

**Found during remediation, not in the audit:** `Modals.tsx` had conditional hooks — `if (!hasModal) return null` above eight hooks — so **every modal in the app crashed on open**. Found by the new test suite; invisible to typecheck and to seven read-only auditors.

## Known remaining work

**Product gaps (never claimed fixed)**
- `formula` fields persist but nothing evaluates them. Relabelled "Formula (not evaluated)" with an in-app warning rather than removed, because removal would strand persisted fields and silently render them as Signature.
- `stamp` renders as a text input on the signing surface and gets no type-aware rendering in the final PDF.
- No PAdES/PKCS#7 signature on the output PDF — this is Simple Electronic Signature only, and must not be marketed as AdES/QES.
- No certificate-of-completion PDF export (the content exists inside the final PDF).
- No SSO/SAML, no WebAuthn passkeys. The fake buttons are gone; the features are not built.
- No public verification endpoint, so the audit QR block remains removed rather than functional.

**Carried debt**
- `recipsOf()` fallback in `state.tsx:262` is a live path that can still surface a prototype name. Unpicking it touches the builder's recipient state model.
- The `.ok ? data : FALLBACK` silent-degradation pattern remains in ~25 server pages; `ApiUnavailable` is the drop-in, each needs a judgement about which call is load-bearing.
- No data migration for field rows authored before the C1 fix — their stored `y` is now read under the new origin. Every prior placement was wrong anyway, but a deployment with real data needs a decision here.
- Tailwind is wired but `@tailwind base` is deliberately omitted; ~1,100 inline-styled sites remain. Four-step migration path documented.
- `set_default_payment_method` is a no-op on the Stripe adapter — the ABC signature doesn't carry the customer id.
- GDPR erasure is designed (crypto-shredding on the existing keyring) but not built. Retention tiers remain plan copy, not enforcement.
- GitHub Actions has never actually run — CI is validated by YAML parse plus running its commands locally.

## Notes for deploying this

1. `SESSION_JWT_SECRET` must be set on the Next server, identical to the backend's `JWT_SECRET` — edge cookie verification **fails closed on privilege** without it.
2. `BILLING_PROVIDER=null` is not deployable; the startup guard rejects it. Set `stripe` plus both Stripe keys.
3. `EMBED_FRAME_ANCESTORS` is a **build arg**, not a runtime env — `headers()` bakes into the manifest at build time.
4. Access tokens are now 15 minutes. The frontend refreshes on a 30s skew; concurrent refreshes can race because backend rotation revokes on first use. A short backend tolerance window would close it.
5. **pnpm 11 ignores package.json's `pnpm` field** — `overrides` live in `frontend/pnpm-workspace.yaml`. That file is security-critical: it forces Next's *vendored* postcss onto a patched version, and without it the build succeeds while carrying 4 advisories (incl. arbitrary `.map` file read). CI fails if it goes missing. Verify after any dependency change with `pnpm why postcss` — it must report one version.
6. Run `scripts/run_billing_cycle.py` — without it no invoice is ever issued and no failed payment retried.
