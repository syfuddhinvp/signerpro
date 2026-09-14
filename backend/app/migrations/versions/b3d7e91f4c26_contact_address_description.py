"""contact address + description (the CRM detail tab)

Revision ID: b3d7e91f4c26
Revises: a4e8b1c6d720
Create Date: 2026-09-11

Guarded like its neighbours: `0001_initial` runs `create_all` against live
metadata, so a fresh database already has both columns when this runs.
"""
from alembic import op
import sqlalchemy as sa


revision = "b3d7e91f4c26"
down_revision = "a4e8b1c6d720"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    existing = _columns("contacts")
    if not existing:
        return
    if "address" not in existing:
        op.add_column("contacts", sa.Column("address", sa.String(length=500), nullable=True))
    if "description" not in existing:
        op.add_column("contacts", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    existing = _columns("contacts")
    if "description" in existing:
        op.drop_column("contacts", "description")
    if "address" in existing:
        op.drop_column("contacts", "address")
