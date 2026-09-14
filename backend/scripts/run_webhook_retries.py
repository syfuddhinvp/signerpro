"""Cron entrypoint: attempt every webhook delivery whose backoff has elapsed.

``webhook_service.process_due_retries()`` has always existed and been tested,
but nothing in the deployment called it (AUDIT_REPORT.md finding 21). The
consequence was specific: a customer endpoint that 502s once was retried
*never*, while the deliveries screen cheerfully showed a scheduled retry. All
the state the sweep needs already lives in ``webhook_deliveries``, so this is a
plain idempotent driver:

    * * * * * python scripts/run_webhook_retries.py

Safe to run repeatedly. Runs in bounded batches: a backlog that built up while
the sweep was down (or while a popular endpoint was hard-down) should not
become one unbounded job holding a session open for hours. Whatever this run
does not reach stays due, and the next run continues from there.

Deliveries are attempted inline here rather than on background threads --
a cron process that exits the moment its main thread finishes would otherwise
abandon them, which is the very failure mode the sweep exists to repair.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.core.database import SessionLocal
from app.core.logging import configure_logging, get_logger, new_request_id, request_context
from app.services.webhook_service import webhook_service

logger = get_logger("scripts.run_webhook_retries")

#: Deliveries attempted per transaction.
BATCH_SIZE = int(os.environ.get("WEBHOOK_RETRY_BATCH_SIZE", "100"))
#: Caps a single run. At the default batch size that is 5000 attempts, which is
#: far more than a healthy system produces between sweeps.
MAX_BATCHES = int(os.environ.get("WEBHOOK_RETRY_MAX_BATCHES", "50"))


def sweep(db, *, batch_size: int = BATCH_SIZE, max_batches: int = MAX_BATCHES) -> int:
    """Attempt due deliveries in batches; return how many were attempted."""
    processed = 0
    for _ in range(max_batches):
        attempted = webhook_service.process_due_retries(db, limit=batch_size)
        if not attempted:
            break
        processed += attempted
        if attempted < batch_size:
            break
    return processed


def main() -> None:
    configure_logging()
    # Inline delivery: see the module docstring. A cron process must not hand
    # its work to a thread it will not outlive.
    previous_synchronous = webhook_service.synchronous
    webhook_service.synchronous = True
    db = SessionLocal()
    try:
        with request_context(request_id=new_request_id()):
            processed = sweep(db)
            logger.info("webhook_retry.complete", extra={"processed": processed})
        print(f"Webhook retry sweep complete: {processed} deliveries attempted.")
    except Exception:
        logger.exception("webhook_retry.failed")
        db.rollback()
        raise SystemExit(1)
    finally:
        webhook_service.synchronous = previous_synchronous
        db.close()


if __name__ == "__main__":
    main()
