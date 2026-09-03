"""Create the Stripe Products and Prices this app's plan catalogue needs.

Checkout is refused for any plan without an ``external_price_id`` -- Stripe has
no idea what a "business" plan is, only what ``price_1ABC...`` costs. On a fresh
database every plan has a null price id, so this script is the step that makes
paid checkout work at all.

    python scripts/provision_stripe_plans.py --dry-run   # show the plan
    python scripts/provision_stripe_plans.py             # apply it

It is idempotent. The Stripe Product carries an id we choose
(``signforge_<plan_code>``) and the Price carries a lookup key derived from its
own amount, so a second run finds both and creates nothing. Changing a plan's
price creates one *new* price and repoints the plan at it -- Stripe prices are
immutable and existing subscribers stay on the old one until they change plan,
which is the behaviour you want.

It refuses to run against a live key. Provisioning a real product catalogue is
a deliberate act, not something a setup script should do by accident.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.plan import Plan
from app.services.billing_service import (
    StripeApiError,
    StripePaymentProvider,
    billing_service,
)


class LiveAccountRefused(RuntimeError):
    """The configured key is a live key. This script only provisions test mode."""


def plan_pricing(plan: Plan) -> tuple[int, str]:
    """``(unit_amount_cents, interval)`` for the recurring Stripe price.

    Seat-based plans price the *seat*: the Stripe subscription carries a
    quantity, so the unit amount must be the per-seat figure the app charges,
    not the whole-plan figure. Deriving both from the same row is what keeps
    the Stripe catalogue and the in-app invoice preview from disagreeing.
    """
    unit = plan.seat_price_cents if (plan.is_seat_based and plan.seat_price_cents) else plan.price_cents
    interval = "year" if plan.billing_interval == "year" else "month"
    return int(unit), interval


def provisionable_plans(db: Session) -> list[Plan]:
    """Every active plan that costs money. A free plan needs no Stripe price."""
    plans = db.scalars(select(Plan).order_by(Plan.sort_order, Plan.code)).all()
    out = []
    for plan in plans:
        unit, _ = plan_pricing(plan)
        if plan.is_active and unit > 0:
            out.append(plan)
    return list(out)


def provision(
    db: Session,
    provider: StripePaymentProvider,
    *,
    dry_run: bool = False,
    echo=print,
) -> dict[str, str]:
    """Returns ``{plan_code: price_id}`` for everything provisioned or found."""
    if provider.is_live_key:
        raise LiveAccountRefused(
            "STRIPE_SECRET_KEY is a LIVE key. This script provisions the test-mode "
            "catalogue only; run it with an sk_test_… key."
        )

    billing_service.ensure_default_plans(db)
    results: dict[str, str] = {}
    for plan in provisionable_plans(db):
        unit_amount, interval = plan_pricing(plan)
        lookup_key = provider.price_lookup_key(plan.code, interval, unit_amount, plan.currency)
        if dry_run:
            echo(
                f"  would ensure product {provider.product_id_for(plan.code)!r} "
                f"and price {lookup_key!r} "
                f"({unit_amount / 100:.2f} {plan.currency.upper()} / {interval})"
                + ("" if not plan.external_price_id else f" [currently {plan.external_price_id}]")
            )
            continue

        product = provider.ensure_product(
            plan_code=plan.code, name=plan.name, description=plan.description
        )
        price = provider.ensure_price(
            plan_code=plan.code,
            product_id=str(product.get("id")),
            unit_amount=unit_amount,
            currency=plan.currency,
            interval=interval,
        )
        price_id = str(price.get("id") or "")
        if not price_id:
            raise RuntimeError(f"Stripe returned no price id for plan {plan.code!r}")
        results[plan.code] = price_id
        if plan.external_price_id != price_id:
            echo(f"  {plan.code}: {plan.external_price_id or '(none)'} -> {price_id}")
            plan.external_price_id = price_id
            db.add(plan)
        else:
            echo(f"  {plan.code}: already {price_id}")
    if not dry_run:
        db.commit()
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Provision Stripe test-mode products and prices for the plan catalogue."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print what would be created; touch nothing."
    )
    args = parser.parse_args()

    try:
        provider = StripePaymentProvider()
    except Exception as exc:  # missing/unsafe key -- the message says which
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(f"Stripe key mode: {provider.mode}")
    db = SessionLocal()
    try:
        provision(db, provider, dry_run=args.dry_run)
    except LiveAccountRefused as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 2
    except StripeApiError as exc:
        print(f"stripe error: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()
    print("done." if not args.dry_run else "dry run: nothing was created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
