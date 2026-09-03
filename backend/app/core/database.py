from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
_is_sqlite = settings.database_url.startswith("sqlite")
connect_args = {"check_same_thread": False} if _is_sqlite else {}

# Pool sizing is deliberate, not default. See the budget arithmetic on
# ``Settings.db_pool_size``: unconfigured, SQLAlchemy allows 15 connections per
# worker process, so three replicas of four workers exhaust PostgreSQL's
# default ``max_connections = 100`` and the deployment fails to start.
#
# SQLite's pooling is a different mechanism entirely (and the test suite pins
# its own StaticPool), so these apply only to a real server.
_pool_kwargs: dict[str, object] = (
    {}
    if _is_sqlite
    else {
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        "pool_recycle": settings.db_pool_recycle_seconds,
        "pool_timeout": settings.db_pool_timeout_seconds,
    }
)

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    **_pool_kwargs,
)


def pool_status() -> dict[str, int | str]:
    """Pool occupancy, for the readiness endpoint and for incident triage."""
    pool = engine.pool
    status: dict[str, int | str] = {"impl": type(pool).__name__}
    for attribute in ("size", "checkedin", "checkedout", "overflow"):
        getter = getattr(pool, attribute, None)
        if callable(getter):
            try:
                status[attribute] = getter()
            except Exception:  # noqa: BLE001 - triage data is never worth a 500
                pass
    return status
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def background_session() -> Generator[Session, None, None]:
    """A session for code outside the FastAPI dependency graph.

    Middleware and background jobs cannot use ``Depends(get_db)``. This honours
    a ``get_db`` dependency override when one is installed, so a test suite
    that points the app at its own in-memory engine also captures writes made
    by middleware -- otherwise those rows would silently land in a different
    database.
    """

    override = None
    try:  # pragma: no cover - import cycle guard, app.main imports this module
        from app.main import app as fastapi_app

        override = fastapi_app.dependency_overrides.get(get_db)
    except Exception:
        override = None

    if override is not None:
        generator = override()
        db = next(generator)
        try:
            yield db
        finally:
            generator.close()
        return

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

