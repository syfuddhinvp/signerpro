"""field validation/condition/merge-tag columns, FieldType enum extension, routing defaults

Revision ID: d2f4a2b6c702
Revises: d1f4a2b6c701
Create Date: 2026-08-28

`fields.type` is a SQLAlchemy `Enum`, i.e. a native ENUM type on PostgreSQL and
a VARCHAR + CHECK constraint on SQLite. New members therefore need
`ALTER TYPE ... ADD VALUE` on PostgreSQL only; SQLite databases created by
`create_all` already carry the full member list, and rebuilding a CHECK
constraint on an existing SQLite file is not worth the table copy (SQLite does
not enforce it for values written through the ORM's own enum).
"""
from alembic import op
import sqlalchemy as sa


revision = "d2f4a2b6c702"
down_revision = "d1f4a2b6c701"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)

NEW_FIELD_TYPES = ("stamp", "attachment", "formula", "datetime")


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    if not _has_table(table):
        return set()
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    _add_column("fields", sa.Column("validation", sa.String(20), nullable=False, server_default="none"))
    _add_column("fields", sa.Column("validation_pattern", sa.String(255), nullable=True))
    _add_column("fields", sa.Column("condition", sa.JSON(), nullable=True))
    _add_column("fields", sa.Column("merge_tag", sa.String(120), nullable=True))
    _add_column("fields", sa.Column("read_only", sa.Boolean(), nullable=False, server_default=sa.false()))

    _add_column("documents", sa.Column("reminder_cadence", sa.String(10), nullable=False, server_default="48h"))
    _add_column("documents", sa.Column("expires_in_days", sa.Integer(), nullable=False, server_default="14"))
    _add_column("documents", sa.Column("invite_subject", sa.String(255), nullable=True))
    _add_column("documents", sa.Column("invite_message", sa.Text(), nullable=True))

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
        with op.get_context().autocommit_block():
            for value in NEW_FIELD_TYPES:
                op.execute(f"ALTER TYPE fieldtype ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    for column in ("invite_message", "invite_subject", "expires_in_days", "reminder_cadence"):
        if column in _columns("documents"):
            op.drop_column("documents", column)
    for column in ("read_only", "merge_tag", "condition", "validation_pattern", "validation"):
        if column in _columns("fields"):
            op.drop_column("fields", column)
    # PostgreSQL cannot remove enum members; the added FieldType values stay.
