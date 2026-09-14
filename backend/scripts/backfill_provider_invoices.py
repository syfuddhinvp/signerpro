from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.core.database import SessionLocal
from app.core.logging import configure_logging, get_logger, new_request_id, request_context
from app.services.billing_service import billing_service

logger = get_logger("scripts.backfill_provider_invoices")


def main() -> None:
    """One-off recovery: mirror the payment provider's existing invoices locally.

    Until the webhook learned to mirror them, a provider-billed subscription
    produced no local ``invoices`` row when the customer paid -- the first one
    appeared only when ``run_billing_cycle`` closed the period, roughly a month
    later. Everything charged before that fix is still in the provider's
    records; this reads it back and records it.

    Idempotent (matched on ``provider_invoice_id``), so re-running it updates
    rather than duplicates, and it can be used routinely to reconcile against
    the provider:

        python scripts/backfill_provider_invoices.py
        python scripts/backfill_provider_invoices.py --organization-id <id>
    """

    parser = argparse.ArgumentParser(description="Mirror provider invoices into the local table.")
    parser.add_argument(
        "--organization-id",
        default=None,
        help="Only this organization. Default: every organization with a provider customer.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Most recent invoices to read per customer (default 100).",
    )
    args = parser.parse_args()

    configure_logging()
    db = SessionLocal()
    try:
        with request_context(request_id=new_request_id()):
            report = billing_service.backfill_provider_invoices(
                db, organization_id=args.organization_id, limit=args.limit
            )
            logger.info("billing.invoice_backfill_complete", extra={"report": report})
            print(
                "Invoice backfill: "
                f"{report['organizations']} organizations, "
                f"{report['created']} created, "
                f"{report['updated']} updated, "
                f"{report['skipped']} skipped."
            )
    except Exception:
        logger.exception("billing.invoice_backfill_failed")
        db.rollback()
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
