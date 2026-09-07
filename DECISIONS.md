# SignForge — Decision Register

**Date:** 3 September 2026 · Companion to `COMPLETION_PLAN.md`.

The purpose of this file is to let the remaining work in `COMPLETION_PLAN.md` be executed without
stopping at every fork. Each decision below is **pre-made**: an agent or engineer picking up the work
follows it and proceeds. §3 is the short list of things that must *not* be decided unilaterally.

Format: **D-n — the decision · why · how to apply · what would reverse it.**

---

## 1. Standing decisions

### D1 — Ship Simple Electronic Signature. Never claim more.
**Decision.** The product is a Simple Electronic Signature platform under ESIGN/UETA. No PAdES,
no PKCS#7 seal, no AdES/QES, no PCI claim, no "certified" or "compliant with" any framework that
has not been assessed.
**Why.** The legal claim the product actually earns is the tamper-evident audit chain (persisted
checksums, `verify_chain` detecting modification, deletion, reordering, insertion, truncation) plus
identity verification (OTP) and consent capture. That is a genuine and defensible product. Claiming
cryptographic document sealing that does not exist is the kind of misstatement that converts a
software bug into liability — and the audit already caught one false PCI claim in the UI.
**How to apply.** Any new copy, marketing page, or plan description goes through this filter before
merge. When a customer asks for AdES, the answer is "not today", not a roadmap promise in the UI.
**Amended 4 September 2026 — W14 is built, and the rule is unchanged.** PAdES sealing now exists
(`pades_service`), but it is **off unless a signing certificate is configured**, so the default
product is still SES and still described as such. The signature level is no longer a hardcoded
string anywhere: `describe()` returns what is actually in force, and the certificate summary, the
public verification API and the verification page all report that. A self-signed certificate
produces a sealed document that no reader's trust store trusts — real tamper-evidence at the file
level, and emphatically not QES. Nothing here licenses claiming QES; it licenses claiming exactly
what the configured certificate supports.
**Reversed by.** Nothing. The rule was never "don't build it", it was "don't claim it".

### D2 — `formula` fields stay retired; do not remove the type.
**Decision.** Keep `formula` in the backend enum and in `adapters.ts`'s round trip, keep it out of
the placeable palette, keep the "Formula (retired)" label.
**Why.** Removing the type strands rows already persisted as `formula` and silently renders them as
Signature — a wrong executed contract, which is exactly the C1 class of failure. Retiring it is
honest and costs nothing. Building evaluation is a real feature (2–3 days) that no current user has
asked for.
**How to apply.** If evaluation is built later, it is built as a new capability behind the existing
type, not as a migration of the type.
**Amended 7 September 2026 — the type is removed, by owner decision.** W10 built evaluation, so the
"don't remove it" half of D2 had already been superseded once. It is now withdrawn the other way:
the owner asked for merge tags to go, and a `formula` field exists only to reference other fields by
merge tag, so the type went with them (`c7a5b2d94f70`). The C1 concern D2 raised is answered rather
than ignored — the migration rewrites existing `formula` rows to `text` and clears their options, so
no row renders as a Signature and no value is stamped as though it were still derived. PostgreSQL
cannot drop an ENUM member, so `fieldtype` keeps an unused `formula` value; nothing writes it.
`currency` is untouched and still parses amounts, now via `currency_service`.
**Reversed by.** A named customer requirement for calculated fields — which would be a fresh build,
not a revert.

### D3 — Defer SSO/SAML, WebAuthn, and PAdES until a paying enterprise account requires one.
**Decision.** These stay unbuilt and undisclosed-as-coming. The fake buttons are already gone; that
is the correct end state for now.
**Why.** Each is 1–3 weeks and each is only ever bought by enterprise buyers. Building them
speculatively before v1 ships delays every customer to serve none.
**How to apply.** In the enterprise plan description, these are absent, not "coming soon".
**Amended 4 September 2026 — both are built.** WebAuthn passkeys and SAML SSO now exist, so the
"deferred" half of this decision no longer applies. What survives is the reasoning about *claims*:
neither is marketed as more than it is, and both refuse rather than degrade when misconfigured. The
enterprise plan should now list them because they exist, not because they are coming.
**Reversed by.** Nothing left to reverse.

### D4 — Pre-C1 field coordinates: purge, do not migrate.
**Decision.** For any environment that predates the C1 origin fix, delete field rows on unsent
documents and require re-placement; leave sent/executed documents untouched and flagged.
**Why.** Every prior placement was already wrong — the fields were stamped vertically mirrored, so
there is no correct historical value to recover. A "migration" would be inventing an intent nobody
recorded. Re-placement on an unsent draft is cheap; silently rewriting coordinates under an executed
contract is not defensible.
**How to apply.** Ship it as a one-shot script, not an Alembic data migration, so it is an explicit
operator action with a printed count. If the target environment has no pre-fix data — which is true
of every environment today — it is a no-op and this decision costs nothing.
**Reversed by.** Discovering a production dataset where drafts are numerous and re-placement is
genuinely expensive.

### D5 — Silent degradation is a bug, and `ApiUnavailable` is the default fix.
**Decision.** The `.ok ? data : FALLBACK` pattern in the remaining 26 server pages is replaced with
`ApiUnavailable` **unless** the specific call is genuinely decorative.
**Why.** The audit found 37 instances of fabricated data presented as the user's own. A page that
shows plausible-looking invented numbers when the API is down is worse than a page that says the API
is down — the user makes decisions on fiction.
**How to apply.** Per file, ask: if this call fails, would the page still be truthful? If no →
`ApiUnavailable`. If yes (a sidebar count, a decorative badge) → an empty state, never a fabricated
value. Default to `ApiUnavailable` when it is a close call.
**Reversed by.** Nothing. This one is not a trade-off.

### D6 — Correctness gates are hard gates; they are never "fixed later".
**Decision.** The §5 verification block in `COMPLETION_PLAN.md` runs before every merge and every
phase sign-off. Zero advisories, zero failing tests, exactly one postcss version.
**Why.** `pnpm why postcss` is load-bearing security infrastructure — pnpm 11 ignores package.json's
`pnpm` field, so overrides live in `pnpm-workspace.yaml`, and without that file the build *succeeds*
while carrying four advisories including an arbitrary `.map` file read. A green build is not evidence.
**How to apply.** CI enforces it. If CI is red, that is the work; nothing else proceeds.
**Reversed by.** Nothing.

### D7 — Prefer execution over inspection when verifying anything.
**Decision.** No claim about behaviour enters a document without a command that produced it.
**Why.** Two of the worst defects in this codebase's history — mirrored PDF coordinates and the
`Modals.tsx` conditional hooks that crashed *every modal in the app* — passed typecheck, passed
review, and survived seven read-only audit agents. Both were caught by running the thing.
**How to apply.** Every status table carries the command that produced its numbers, as §1 of
`COMPLETION_PLAN.md` does.
**Reversed by.** Nothing.

### D8 — Documentation that contradicts the code is a defect with a ticket, not a stale file.
**Decision.** `REMEDIATION.md`'s "known remaining work" and `PROJECT_PROGRESS.md` are wrong today
(they describe gaps that are closed and a 7-test prototype that no longer exists). W18 fixes them.
**Why.** A stale status doc causes an agent or engineer to redo finished work or, worse, to trust a
"known gap" list that omits a real gap.
**How to apply.** Docs update in the same commit as the behaviour they describe.
**Reversed by.** Nothing.

---

## 2. Autonomy rule — what may proceed without asking

Proceed without checking in when the work is:

- listed in `COMPLETION_PLAN.md` §3 and covered by a decision above;
- reversible in the working tree (code, tests, docs, local config);
- verified by the §5 gate before being called done.

Handle ambiguity the way a careful engineer would: choose the safer default, write down the
assumption in the relevant doc, and keep going. Report the assumption; do not block on it.

## 3. Escalate — decide with the human, always

These are outside the autonomy rule regardless of how obvious the answer looks:

1. **Anything that touches customer data in a real environment** — the D4 purge script, GDPR
   erasure, any destructive migration. Design it, test it, then hand over the run.
2. **Anything outward-facing** — pushing to a shared remote is fine on a feature branch; opening a
   PR against `main`, merging, deploying, or sending real email/SMS/webhooks to real endpoints is not.
3. **Money** — Stripe keys, live-mode anything, plan pricing, provisioning products.
4. **Legal and compliance claims** — any change to what the product asserts about ESIGN/UETA/GDPR/
   PCI/SOC2, per D1.
5. **Reversing a decision in §1** — the register is amended deliberately, in writing, not by drifting
   past it in an implementation.
6. **Scope growth** — a new feature not in `COMPLETION_PLAN.md` §3. Finish v1 first.

When escalation is needed, do everything that does not depend on the answer first, then ask one
specific question with a recommendation attached.
