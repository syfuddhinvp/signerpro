from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
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

