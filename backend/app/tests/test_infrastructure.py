"""Infrastructure guarantees: readiness, CORS validation, pool sizing, headers.

These cover the failure modes from section 9 of the audit that are otherwise
invisible until a deployment falls over: a replica serving traffic against an
unmigrated database, a CORS allowlist containing the empty string, and a
connection pool whose defaults exceed PostgreSQL's ``max_connections``.
"""

from __future__ import annotations

import pytest

from app.core.config import (
    CorsConfigurationError,
    Settings,
    expected_migration_head,
    parse_cors_origins,
)


# --- CORS -----------------------------------------------------------------


def test_cors_origins_drops_empties_and_deduplicates():
    # A trailing comma used to inject an empty origin into the allowlist.
    assert parse_cors_origins("http://a.test, ,http://b.test,http://a.test,") == [
        "http://a.test",
        "http://b.test",
    ]


def test_empty_cors_origins_is_not_a_list_containing_the_empty_string():
    assert parse_cors_origins("", environment="test") == []
    assert parse_cors_origins(None, environment="test") == []


def test_wildcard_cors_origin_is_rejected_because_credentials_are_sent():
    with pytest.raises(CorsConfigurationError, match=r"may not contain"):
        parse_cors_origins("https://a.test,*", environment="test")


@pytest.mark.parametrize("environment", ["production", "staging", "prod", "", None])
def test_empty_cors_origins_fails_startup_in_anything_but_development(environment):
    with pytest.raises(CorsConfigurationError, match=r"is empty"):
        parse_cors_origins("", environment=environment)


def test_empty_cors_origins_is_tolerated_in_development():
    assert parse_cors_origins("", environment="development") == []


# --- Connection pool -------------------------------------------------------


def test_pool_is_configured_rather_than_left_to_sqlalchemy_defaults():
    settings = Settings()
    assert settings.db_pool_size > 0
    assert settings.db_max_overflow >= 0
    assert settings.db_pool_recycle_seconds > 0
    assert settings.db_pool_timeout_seconds > 0


def test_default_pool_budget_fits_under_postgres_default_max_connections():
    """3 replicas x 4 workers must stay under ``max_connections = 100``.

    SQLAlchemy's own defaults (5 + 10) give 180 here, which is why an
    unconfigured deployment fails to start.
    """
    settings = Settings()
    per_worker = settings.db_pool_size + settings.db_max_overflow
    assert 3 * 4 * per_worker < 100, f"{per_worker} connections/worker is too many"


def test_pool_status_reports_occupancy():
    from app.core.database import pool_status

    status = pool_status()
    assert "impl" in status


# --- Readiness -------------------------------------------------------------


def test_liveness_is_cheap_and_unconditional(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_readiness_reports_every_dependency(client):
    body = client.get("/api/health/ready").json()
    assert set(body["checks"]) == {"database", "storage", "migrations"}
    assert body["checks"]["database"]["status"] == "ok"
    assert body["checks"]["storage"]["status"] == "ok"


def test_readiness_is_503_when_the_database_is_unreachable(client, monkeypatch):
    """The whole point: an orchestrator must stop routing to this replica."""
    from sqlalchemy.exc import OperationalError

    import app.core.database as database

    def explode():
        raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    monkeypatch.setattr(database.engine, "connect", explode)
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["database"]["status"] == "fail"
    # Liveness must NOT fail with it, or every replica restarts at once.
    assert client.get("/api/health").status_code == 200


def test_readiness_is_503_when_storage_is_unwritable(client, monkeypatch):
    from app.core.storage import storage

    def explode():
        raise OSError("read-only file system")

    monkeypatch.setattr(storage, "health_check", explode)
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json()["checks"]["storage"]["status"] == "fail"


@pytest.fixture()
def stamped(client, tmp_path, monkeypatch):
    """Point the readiness probe at a database with a real ``alembic_version``.

    The suite builds its schema with ``create_all`` against an in-memory
    SQLite that gives every connection a *fresh* empty database, so nothing
    written here would survive to the next connection. A file-backed engine
    for the duration of the test is the smallest thing that makes the
    migration assertion testable at all.
    """
    from sqlalchemy import create_engine, text

    import app.core.database as database

    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'ready.db'}")
    monkeypatch.setattr(database, "engine", engine)

    def stamp(revision: str) -> None:
        with engine.begin() as connection:
            connection.execute(
                text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL)")
            )
            connection.execute(text("DELETE FROM alembic_version"))
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": revision}
            )

    return stamp


def test_readiness_passes_when_the_database_is_at_the_expected_head(client, stamped):
    stamped(expected_migration_head())
    body = client.get("/api/health/ready").json()
    assert body["checks"]["migrations"]["status"] == "ok"


def test_readiness_fails_when_the_database_is_at_the_wrong_migration(client, stamped):
    """A silent C10-class failure made loud.

    A replica running new code against a database that was never migrated (or
    old code against a migrated one) can accept requests and then fail on the
    first query touching a column that does not exist. This makes it refuse
    traffic instead.
    """
    stamped("0001_initial")
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    migrations = response.json()["checks"]["migrations"]
    assert migrations["status"] == "fail"
    assert "alembic upgrade head" in migrations["error"]


def test_readiness_fails_when_the_database_was_never_migrated_at_all(client):
    """No ``alembic_version`` table is not "fine", it is "schema of unknown origin"."""
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json()["checks"]["migrations"]["status"] == "fail"


def test_the_build_resolves_exactly_one_migration_head():
    """A branched chain would make the readiness assertion unenforceable."""
    assert expected_migration_head() is not None


# --- Rate limiting ---------------------------------------------------------


def test_rate_limit_backend_defaults_to_in_memory():
    from app.core.ratelimit import InMemoryRateLimitBackend, build_backend

    assert isinstance(build_backend(), InMemoryRateLimitBackend)


def test_unknown_or_unconfigured_redis_falls_back_rather_than_refusing_to_boot(monkeypatch):
    import app.core.ratelimit as ratelimit
    from app.core.ratelimit import InMemoryRateLimitBackend

    settings = ratelimit.get_settings()
    monkeypatch.setattr(settings, "rate_limit_backend", "redis", raising=False)
    monkeypatch.setattr(settings, "redis_url", None, raising=False)
    assert isinstance(ratelimit.build_backend(), InMemoryRateLimitBackend)
