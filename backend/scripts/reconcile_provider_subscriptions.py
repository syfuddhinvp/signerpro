"""Find provider subscriptions this database does not know about.

**Read-only. This script cancels nothing.** It lists what it finds and prints
the commands that would fix it, because cancelling a live subscription is
somebody's money and is not a decision a script should take on its own.

Why it exists: a Stripe Checkout Session in ``subscription`` mode *creates* a
subscription rather than modifying the existing one. Using checkout for a plan
change therefore started a new subscription each time and overwrote
``provider_subscription_id`` with its id -- leaving the previous one active,
billing monthly, and unreachable by anything here, since the only handle on it
had just been overwritten. One customer accumulated four concurrent
subscriptions ($44 + $28 + $12 + $44 a month) while this application showed a
single $44 plan.

``start_checkout`` now refuses when a subscription already exists and
``_apply_event`` cancels the one it supersedes, so new orphans should not
appear. This finds the ones already out there, and is worth running on a
schedule: the reason the original went unnoticed is that nothing ever looked.

    python -m scripts.reconcile_provider_subscriptions
"""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.database import SessionLocal
from app.models.organization import Organization
from app.models.subscription import Subscription
from app.services.billing_service import StripePaymentProvider, _stripe_setting


def main() -> int:
    if not _stripe_setting("stripe_secret_key", "STRIPE_SECRET_KEY"):
        print("No Stripe key configured; nothing to reconcile.")
        return 0

    provider = StripePaymentProvider()
    db = SessionLocal()
    orphans: list[tuple[str, str, str, int]] = []
    try:
        for subscription in db.scalars(select(Subscription)):
            customer_id = subscription.provider_customer_id
            if not customer_id:
                continue
            org = db.get(Organization, subscription.organization_id)
            org_name = org.name if org else subscription.organization_id

            try:
                remote = provider._request(
                    "GET",
                    "/v1/subscriptions",
                    {"customer": customer_id, "status": "active", "limit": 100},
                )
            except Exception as exc:  # noqa: BLE001 - one bad customer must not stop the sweep
                print(f"!! {org_name}: could not list subscriptions ({exc})")
                continue

            known = subscription.provider_subscription_id
            rows = remote.get("data") or []
            print(f"\n{org_name}  ({customer_id})")
            print(f"  known here: {known or '—'}")
            for row in rows:
                items = (row.get("items") or {}).get("data") or []
                amount = sum(
                    int((item.get("price") or {}).get("unit_amount") or 0)
                    * int(item.get("quantity") or 1)
                    for item in items
                )
                tag = "KNOWN" if row["id"] == known else "ORPHAN"
                print(f"  [{tag}] {row['id']}  {amount / 100:.2f}/{row.get('status')}")
                if tag == "ORPHAN":
                    orphans.append((org_name, customer_id, row["id"], amount))
    finally:
        db.close()

    if not orphans:
        print("\nNo orphaned subscriptions. Every active provider subscription is accounted for.")
        return 0

    monthly = sum(amount for _, _, _, amount in orphans)
    print(
        f"\n{len(orphans)} orphaned subscription(s), "
        f"{monthly / 100:.2f} per month billing with nothing here to show for it."
    )
    print("\nNothing has been changed. To cancel one, in the Stripe dashboard or:")
    for org_name, _customer, subscription_id, amount in orphans:
        print(f"  stripe subscriptions cancel {subscription_id}   # {org_name}, {amount / 100:.2f}/mo")
    return 1


if __name__ == "__main__":
    sys.exit(main())
