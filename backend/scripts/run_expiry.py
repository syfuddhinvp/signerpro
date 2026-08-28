from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.core.database import SessionLocal
from app.core.logging import configure_logging, get_logger, new_request_id, request_context
from app.services.expiry_service import expiry_service

logger = get_logger("scripts.run_expiry")


def main() -> None:
    """Cron entrypoint: expire overdue documents and signing tokens.

    Safe to run repeatedly (e.g. ``*/10 * * * * python scripts/run_expiry.py``).
    """

    configure_logging()
    db = SessionLocal()
    try:
        with request_context(request_id=new_request_id()):
            report = expiry_service.run(db)
        print(
            "Expiry sweep complete: "
            f"{report.documents_expired} documents, "
            f"{report.recipients_expired} recipients, "
            f"{report.tokens_expired} tokens."
        )
    except Exception:
        logger.exception("expiry.sweep_failed")
        db.rollback()
        raise SystemExit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
