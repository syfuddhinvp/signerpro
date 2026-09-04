"""Wait for Postgres, then run `alembic upgrade head` under an advisory lock.

Run by ``docker-entrypoint.sh`` before the application starts. Safe to run from
every replica concurrently: ``pg_advisory_lock`` is a blocking, session-scoped
lock, so the first replica migrates while the rest wait on the same key and
then find themselves already at head.

Exits non-zero if the database never becomes reachable or the migration fails,
so the container fails fast instead of serving against a stale schema.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import sys
import time

import psycopg

LOCK_ID = int(os.environ.get("MIGRATION_LOCK_ID", "8452113697"))
WAIT_TIMEOUT = float(os.environ.get("DB_WAIT_TIMEOUT", "60"))


def log(message: str) -> None:
    print(f"migrate: {message}", file=sys.stderr, flush=True)


def libpq_dsn(url: str) -> str:
    """Strip the SQLAlchemy driver suffix (``postgresql+psycopg://``)."""
    return re.sub(r"^postgresql\+[a-z0-9_]+://", "postgresql://", url)


def wait_for_db(dsn: str) -> None:
    deadline = time.monotonic() + WAIT_TIMEOUT
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with psycopg.connect(dsn, connect_timeout=5) as conn:
                conn.execute("SELECT 1")
            log("database is reachable")
            return
        except Exception as exc:  # noqa: BLE001 - any connection failure is retryable
            last_error = exc
            log(f"waiting for database... ({exc.__class__.__name__})")
            time.sleep(2)
    log(f"database not reachable after {WAIT_TIMEOUT}s: {last_error}")
    raise SystemExit(1)


def upgrade_under_lock(dsn: str) -> None:
    from alembic import command
    from alembic.config import Config

    # autocommit: pg_advisory_lock must be held on the session, not inside a
    # transaction that alembic's own connection would be unaware of.
    with psycopg.connect(dsn, autocommit=True) as conn:
        log(f"acquiring migration advisory lock {LOCK_ID} (blocking)")
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_ID,))
        try:
            log("running alembic upgrade head")
            config = Config(str(Path(__file__).resolve().parent / "alembic.ini"))
            command.upgrade(config, "head")
            log("migrations up to date")
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
            log("released migration advisory lock")


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        log("DATABASE_URL is unset; nothing to do")
        return
    dsn = libpq_dsn(url)
    wait_for_db(dsn)
    upgrade_under_lock(dsn)


if __name__ == "__main__":
    main()
