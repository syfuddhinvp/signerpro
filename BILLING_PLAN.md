# Plan change and wallet credit

How an organization moves between plans, what it pays, and what happens to
money it has already paid for time or capacity it no longer uses.

Companion to `PLATFORM_PLAN.md`. Everything below lives in
`backend/app/services/billing_service.py` unless stated otherwise.

**Status: built.** Sections 1-7 are implemented, including section 5a, which
was found in live data *after* the rest and is the most serious item here. The pieces that did not exist
before are `app/models/wallet.py`, `app/services/wallet_service.py`,
`app/services/plan_change_service.py`, the `pending_plan_*` columns on
`subscriptions`, and migrations `b3d5f7a92c41` and `c4e6a8b13d52`. One
deviation from section 1 is recorded there.

## 1. Two ceilings, not one

A recurring source of confusion in the current code is that "can this org add
a user?" has two different answers behind it, and only one of them is a plan
change:

| | What it is | Where it lives | How it grows |
|---|---|---|---|
| `max_users` | The plan's hard cap. Team is capped at 5 regardless of payment. | `plans.entitlements` | Only by changing plan |
| `seats_licensed` | How many of that cap the org has bought. | `organizations.seats_licensed` | `change_seats`, prorated |

`invitation_service.py:47` checks `max_users` and nothing else, so an org can
today invite past the seats it pays for as long as the plan cap allows it —
`organization_service.py:215` catches some of this but the invite path does
not. Both ceilings must be checked at the same point, and the error must say
which one was hit, because the fix differs: one is "buy a seat", the other is
"upgrade".

**This answers the "upgraded, then added a user the package does not support"
case.** The add is refused at the invite, not silently allowed and billed
later. The 402 body carries both numbers and the cheapest remedy:

- under `max_users`, at `seats_licensed` → `seat_purchase_required`; offer
  `POST /billing/seats` with the prorated price, one click, no plan change;
- at `max_users` → `plan_upgrade_required`; offer the cheapest plan whose
  `max_users` clears the requested count, with the proration quote attached.

The invite is never accepted on credit. A seat bought this way is prorated
against the current period exactly as `change_seats` already does.

**Deviation found while building.** `seat_counts` reports an organization that
has never bought seats as licensing exactly what it uses, which is right for
pricing and wrong for a ceiling: read that way, *every* first invite is "out of
seats", and the first implementation broke nine existing tests by refusing
them. The licensed ceiling therefore applies only when `seats_licensed` is
explicitly greater than zero. An organization that has never bought seats is
governed by the plan cap alone, exactly as before.

## 2. Direction decides timing

`preview_plan_change` already computes the proration. What it does not do is
decide *when* the change lands, and the current `change_plan` applies
everything immediately, which is right for one direction and wrong for the
other.

**Upgrade** (proration > 0) — immediate, gated on payment. Keep today's order:
issue invoice, collect, then move the subscription. `collect_invoice` raises
on a decline, so there is no window where an org is entitled but unpaid.

**Downgrade** (proration <= 0) — scheduled for `current_period_end` by
default. The org keeps the entitlements it has paid for until the period ends,
then lands on the smaller plan at renewal. Nothing is charged, nothing is
credited, because nothing was lost.

**Downgrade, immediate** — explicit opt-in (`effective: "immediately"`). The
unused remainder is credited to the wallet (section 3), not refunded.

**Interval switch** (month <-> year) — always starts a new period, as
`_apply_plan_change`'s `keeps_period` already decides. The unused remainder of
the old period is credited to the wallet and drawn down by the new invoice, so
switching to annual mid-month stops silently forfeiting the rest of the month.

### Scheduled changes

`Subscription` gains `pending_plan_id`, `pending_plan_effective_at`,
`pending_plan_requested_at`. A pending change is:

- visible on `SubscriptionResponse` so the billing page can render
  "Team starts 14 Oct" with an undo;
- cancellable via `DELETE /billing/change-plan/pending`;
- cleared by any subsequent plan change or by cancellation;
- applied by `run_renewals` *before* `close_period`, so the renewal invoice is
  cut against the new plan.

At apply time the blockers in section 4 are re-checked. An org that grew past
the target plan's limits during the period keeps its current plan and is
notified, rather than being silently over-provisioned or abruptly cut off.

## 3. Wallet

Money that comes back to a tenant stays in the application as spendable
balance. Nothing returns to a bank account, and there is no withdrawal
endpoint — that is the design, not a limitation to be fixed later.

### Model

`wallet_accounts` — one row per organization: `organization_id` (unique),
`currency`, `balance_cents`, timestamps. `balance_cents` is a cache; the
ledger is the truth.

`wallet_entries` — append-only, never updated or deleted:

- `wallet_account_id`, `amount_cents` (signed: credit positive, debit
  negative), `balance_after_cents`
- `kind` — `downgrade_proration`, `interval_switch_remainder`,
  `seat_reduction`, `overpayment`, `platform_grant`, `invoice_payment`,
  `reversal`
- `description` (tenant-facing), `invoice_id` / `charge_id` nullable refs
- `actor_user_id` nullable — set for platform grants
- `idempotency_key` unique — the same downgrade replayed credits once

Follows the `payment_receipt.py` shape: a service, a model, a migration, and a
backfill script if one is needed.

### Rules

1. **Credit-only exit.** No payout, no refund-to-card path. The API exposes
   balance and history; nothing withdraws.
2. **Spent automatically.** `collect_invoice` draws down the wallet *before*
   touching a payment method. An invoice fully covered by balance is marked
   paid with no provider call at all — which also means autopay keeps working
   for an org with no card while it has balance.
3. **Partial draw.** Balance below the invoice total pays what it can; the
   remainder is charged. Both movements are recorded, so a receipt can show
   "$40.00 balance + $12.00 card".
4. **Never negative.** Every debit is bounded by the current balance, enforced
   in a single transaction with a row lock on `wallet_accounts`. A concurrent
   renewal and manual payment cannot both spend the same dollars.
5. **Single currency per org.** Credits are refused if the plan currency
   differs from the wallet currency; that is a bug to surface, not to convert.
6. **No expiry** in v1. If one is wanted later it is a scheduled `reversal`
   entry, not a mutation of past rows.
7. **Sandbox orgs** get a wallet like anyone else — no provider is involved,
   so nothing here needs the `is_sandbox_organization` guard that
   `collect_invoice` applies to card charges.

### What credits it

| Event | Credit |
|---|---|
| Immediate downgrade | `abs(proration_cents)` — the unused remainder of the old plan |
| Interval switch | Remaining fraction of the paid period, at the old plan's rate |
| Seat reduction mid-period | Prorated value of the removed seats |
| Overpayment / duplicate collection | The excess |
| Platform grant | Whatever a platform admin issues, with a reason, audited |

A scheduled (period-end) downgrade credits nothing — the org used what it
bought.

### Surfaces

- `GET /billing/wallet` — balance plus paginated history
- `POST /platform/tenants/{id}/wallet/credit` — platform-admin grant, reason
  required, written to `platform_audit`
- Wallet balance and the projected draw appear on the upcoming-invoice preview
  (`next_invoice`) and on the plan-change preview, so "this upgrade costs you
  $0 today, from balance" is visible before the click.

## 4. Feasibility: blockers and warnings

`change_seats` refuses to cut below the seats in use. `change_plan` has no
equivalent, so an org with 40 users and live webhooks can drop to a 5-seat
plan and only discover it when the entitlement service starts returning 402s.

New `assess_plan_change(db, organization_id, plan_code)` returns
`{direction, blockers[], warnings[], proration_cents, wallet_applied_cents,
amount_due_cents, effective_at, effective_mode}`, computed from current usage
against the target plan's entitlements:

**Blockers** (409, change refused until resolved) — the target's `max_users`
is below activated users; `max_storage_bytes` is below actual usage. Each
blocker states the remedy in numbers: "remove 12 members first".

**Warnings** (confirmable) — feature entitlements the org uses and will lose:
`custom_branding`, `api_access`, `webhooks`. Each names what stops and when,
which for a scheduled downgrade is the effective date, not today.

The split is a product call and this is where it is recorded: capacity you are
over is a blocker, a feature you will lose is a warning.

## 5. Correctness fixes this pulls in

Found while reading the current path; each is a real defect, not a cleanup.

1. **Double charge on Stripe.** `StripePaymentProvider.change_plan` sends
   `proration_behavior=create_prorations` while `change_plan` also issues and
   collects its own proration invoice. Send `proration_behavior=none` — we own
   proration. Same for `update_seats`.
2. **Provider called before commit.** `_apply_plan_change` calls the provider
   and then commits; a commit failure leaves Stripe on the new plan and us on
   the old. Commit local state first, then call the provider, and leave a
   retryable marker on provider failure rather than rolling back a paid change.
3. **Quote is not honoured.** `change_plan_with_proration` computes the preview
   and `change_plan` recomputes it, so the amount charged is whatever the
   second computation says. Pass the quoted amount in and reject with 409 if it
   has moved, rather than charging a number the tenant never saw.
4. **No idempotency on the upgrade invoice.** A double-submitted upgrade issues
   and collects twice. Key the invoice on
   `(organization_id, target_plan, period_start)`.

## 5a. One organization, one provider subscription (BIL-13)

Found in live data after sections 1-5 were built, and the more serious defect
of the two.

A Stripe Checkout Session in `subscription` mode **creates** a subscription; it
does not modify one. Plan changes were routed through checkout whenever Stripe
was configured, so each change started a *new* remote subscription, and
`_apply_event` then did:

```python
subscription.provider_subscription_id = event.subscription_id
```

The previous subscription was left active and billing, with the only handle on
it overwritten — so nothing here could ever cancel it, or even name it. One
customer accumulated four concurrent subscriptions ($44 + $28 + $12 + $44 a
month) over six days of plan switching, while this application displayed a
single $44 plan. It also explains the invoices: each new subscription bills a
full month immediately, which is why the ledger showed four full charges and no
prorations.

Every billing test passed throughout, because they all run against
`NullPaymentProvider`, whose `change_plan` and `cancel_subscription` are
no-ops. Nothing anywhere asserted what the *provider* was told. That is the
gap that let this reach live data, and it is why `test_provider_subscription_identity.py`
asserts on a recording provider rather than on local rows.

The fix is three parts:

1. **Checkout is for a first purchase only.** `start_checkout` returns 409
   `subscription_exists` when `provider_subscription_id` is set, and the plan
   modal falls through to `changePlan` — modify in place, keep the period,
   prorate the difference (section 2).
2. **Never orphan an id.** `_supersede_provider_subscription` cancels the
   remote subscription before its id is replaced, because the id is the only
   way to reach it. A failure there is logged, not raised: the event being
   applied is a payment that already succeeded.
3. **Look.** `scripts/reconcile_provider_subscriptions.py` lists active
   provider subscriptions that this database does not know about. Read-only —
   it prints the cancel commands and runs none of them. Worth scheduling: the
   original went unnoticed for six days because nothing ever looked.

## 6. Build order

Each step is independently shippable and leaves the system correct.

1. **Wallet model + service + migration.** Ledger, balance, draw-down in
   `collect_invoice`, `GET /billing/wallet`. No behaviour change yet — balance
   is always zero until step 3 credits it.
2. **`assess_plan_change`.** Blockers and warnings surfaced through
   `preview_plan_change`; `change_plan` refuses on blockers. Fixes the silent
   over-limit downgrade.
3. **Directional `change_plan`.** Pending-plan columns, scheduling, the
   `effective` flag, wallet credit on immediate downgrade and interval switch,
   `run_renewals` applying pending changes.
4. **Seat/plan ceiling split** in `invitation_service`, with the two distinct
   402 bodies and their remedies.
5. **Correctness fixes** from section 5 — can land before or with step 3, but
   the Stripe double-charge should not wait.
6. **Frontend.** `Modals.tsx` and `resources.ts`: blockers as hard stops,
   warnings as confirmable, scheduled-downgrade banner with undo, wallet
   balance on the billing page and in the plan-change quote.

## 7. Tests

Extending `backend/app/tests/test_billing_ops.py`, plus a new
`test_wallet.py`:

- downgrade schedules rather than applies; entitlements survive to period end
- `run_renewals` applies the pending plan and invoices at the new price
- an org that outgrew the target plan during the period keeps its current plan
- immediate downgrade credits the wallet; the credit equals the forfeited
  remainder; a replay credits once
- an invoice fully covered by balance is paid with no provider call
- partial draw charges exactly the remainder
- concurrent draw-downs cannot take the balance negative
- no endpoint moves balance out of the application
- invite past `seats_licensed` returns `seat_purchase_required`; past
  `max_users` returns `plan_upgrade_required`
- a blocked downgrade returns 409 naming the blocker
- double-submitted upgrade charges once
- the Stripe path produces exactly one proration
