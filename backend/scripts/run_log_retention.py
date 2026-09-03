"""Cron entrypoint: delete ``system_logs`` rows past their retention window.

The table is append-only and never pruned, which makes it two problems at once:
a disk problem (every mutating request writes a row, forever) and a GDPR one
(the rows carry actor emails and IP addresses, and "we keep it indefinitely"
is not a lawful retention period). ``SystemLog``'s own docstring names this
job as missing.

Safe to run repeatedly and concurrently:

    0 * * * * python scripts/run_log_retention.py

Deletes in bounded batches rather than one statement. A single
``DELETE FROM system_logs WHERE occurred_at < ...`` over months of accumulated
rows takes a long-held lock and a correspondingly enormous WAL segment; small
committed batches keep each transaction short and let the job be interrupted at
any point without losing progress.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from sqlalchemy import delete, func, select

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.logging import configure_logging, get_logger, new_request_id, request_context
from app.models.system_log import SystemLog

logger = get_logger("scripts.run_log_retention")

#: Rows per transaction. Large enough to make progress, small enough that each
#: statement's lock and WAL footprint stay unremarkable.
BATCH_SIZE = int(os.environ.get("LOG_RETENTION_BATCH_SIZE", "5000"))
#: Stops a first run against a huge backlog from becoming an unbounded job.
#: The next scheduled run simply continues where this one stopped.
MAX_BATCHES = int(os.environ.get("LOG_RETENTION_MAX_BATCHES", "200"))


def prune(db, *, cutoff: datetime, batch_size: int = BATCH_SIZE, max_batches: int = MAX_BATCHES) -> int:
    """Delete rows older than ``cutoff``; return how many went."""
    deleted = 0
    for _ in range(max_batches):
        ids = list(
            db.scalars(
                select(SystemLog.id).where(SystemLog.occurred_at < cutoff).limit(batch_size)
            )
        )
        if not ids:
            break
        db.execute(delete(SystemLog).where(SystemLog.id.in_(ids)))
        db.commit()
        deleted += len(ids)
        if len(ids) < batch_size:
            break
    return deleted


def main() -> None:
    configure_logging()
    settings = get_settings()
    days = settings.system_log_retention_days
    if days <= 0:
        print("SYSTEM_LOG_RETENTION_DAYS <= 0: retention disabled, nothing to do.")
        return

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    db = SessionLocal()
    try:
        with request_context(request_id=new_request_id()):
            remaining_before = db.scalar(select(func.count()).select_from(SystemLog)) or 0
            deleted = prune(db, cutoff=cutoff)
            logger.info(
                "log_retention.complete",
                extra={"deleted": deleted, "retention_days": days, "cutoff": cutoff.isoformat()},
            )
        print(
            f"Log retention complete: deleted {deleted} of {remaining_before} rows "
            f"older than {cutoff.isoformat()} ({days}d retention)."
        )
    except Exception:
        logger.exception("log_retention.failed")
        db.rollback()
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
