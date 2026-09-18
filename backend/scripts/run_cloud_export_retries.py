"""Cron entrypoint: attempt every cloud export whose backoff has elapsed.

The twin of ``run_webhook_retries.py``, and for the same reason: without a
driver, a Drive outage during a busy afternoon leaves every export sitting
``pending`` with a scheduled retry that nothing ever performs.

    */5 * * * * python scripts/run_cloud_export_retries.py

Safe to run repeatedly, and bounded: whatever a run does not reach stays due.
Uploads run inline -- a cron process that exits the moment its main thread
finishes must not hand work to a background thread it will not outlive.
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
from app.services.cloud_export_service import cloud_export_service

logger = get_logger("scripts.run_cloud_export_retries")

#: Exports attempted per transaction. Smaller than the webhook batch: each one
#: uploads a whole PDF rather than posting a few kilobytes of JSON.
BATCH_SIZE = int(os.environ.get("CLOUD_EXPORT_RETRY_BATCH_SIZE", "25"))
MAX_BATCHES = int(os.environ.get("CLOUD_EXPORT_RETRY_MAX_BATCHES", "20"))


def sweep(db, *, batch_size: int = BATCH_SIZE, max_batches: int = MAX_BATCHES) -> int:
    """Attempt due exports in batches; return how many were attempted."""
    processed = 0
    for _ in range(max_batches):
        attempted = cloud_export_service.process_due_retries(db, limit=batch_size)
        if not attempted:
            break
        processed += attempted
        if attempted < batch_size:
            break
    return processed


def main() -> None:
    configure_logging()
    previous_synchronous = cloud_export_service.synchronous
    cloud_export_service.synchronous = True
    db = SessionLocal()
    try:
        with request_context(request_id=new_request_id()):
            processed = sweep(db)
            logger.info("cloud_export_retry.complete", extra={"processed": processed})
        print(f"Cloud export retry sweep complete: {processed} exports attempted.")
    except Exception:
        logger.exception("cloud_export_retry.failed")
        db.rollback()
        raise SystemExit(1)
    finally:
        cloud_export_service.synchronous = previous_synchronous
        db.close()


if __name__ == "__main__":
    main()
