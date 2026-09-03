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

logger = get_logger("scripts.run_billing_cycle")


def main() -> None:
    """Cron entrypoint: close billing periods, issue invoices, and retry dunning.

    Two independent drivers, deliberately in one process because they must run
    in this order -- a renewal that declines schedules the first dunning
    attempt, and dunning only ever acts on invoices that already exist:

    * ``run_renewals``  -- for every subscription whose ``current_period_end``
      has passed: issue the invoice for the period that just closed, attempt
      collection when the tenant has autopay and an instrument on file, and
      roll the period forward. Before this existed nothing in the application
      ever constructed an ``Invoice`` and a lapsed period simply read as
      ``expired`` (AUDIT_REPORT.md C7).
    * ``run_dunning``   -- retry every failed charge whose ``next_attempt_at``
      has come due. That column was written and never read, so dunning only
      advanced when a human clicked retry.

    Both are idempotent and safe to run repeatedly; hourly is a good cadence
    (``0 * * * * python scripts/run_billing_cycle.py``).
    """

    parser = argparse.ArgumentParser(description="Close billing periods and drive dunning.")
    parser.add_argument("--renewals-only", action="store_true", help="Skip the dunning pass.")
    parser.add_argument("--dunning-only", action="store_true", help="Skip the renewal pass.")
    args = parser.parse_args()

    configure_logging()
    db = SessionLocal()
    try:
        with request_context(request_id=new_request_id()):
            if not args.dunning_only:
                renewals = billing_service.run_renewals(db)
                logger.info("billing.renewals_complete", extra={"report": renewals})
                print(
                    "Renewals: "
                    f"{renewals['closed']} periods closed, "
                    f"{renewals['collected']} collected, "
                    f"{renewals['failed']} unpaid, "
                    f"{renewals['expired']} cancelled."
                )
            if not args.renewals_only:
                dunning = billing_service.run_dunning(db)
                logger.info("billing.dunning_complete", extra={"report": dunning})
                print(
                    "Dunning: "
                    f"{dunning['attempted']} retried, "
                    f"{dunning['recovered']} recovered, "
                    f"{dunning['failed']} still failing."
                )
    except Exception:
        logger.exception("billing.cycle_failed")
        db.rollback()
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
