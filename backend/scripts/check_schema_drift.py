"""Fail if the live schema and the models disagree.

Meaningful only because ``0001_initial`` is now literal DDL. While it was
``Base.metadata.create_all``, a fresh database was *defined* as "whatever the
models are", so this check could not fail no matter how far the migrations had
drifted -- it was vacuous by construction (audit C10).

Usage::

    DATABASE_URL=postgresql+psycopg://... python -m scripts.check_schema_drift

Exits 0 when clean, 1 with the diff printed when not. Intended for CI, run
against a scratch database that has had ``alembic upgrade head`` applied to it.
"""

from __future__ import annotations

import sys

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from app import models  # noqa: F401 - registers every table on Base.metadata
from app.core.config import get_settings
from app.core.database import Base
from app.migrations.comparators import compare_type


def main() -> int:
    engine = create_engine(get_settings().database_url)
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": compare_type})
        diffs = compare_metadata(context, Base.metadata)
    if not diffs:
        print("schema drift: none")
        return 0
    print(f"schema drift: {len(diffs)} difference(s) between the migrations and the models")
    for diff in diffs:
        print(f"  {diff}")
    print("\nRun `alembic revision --autogenerate` and commit the result.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
