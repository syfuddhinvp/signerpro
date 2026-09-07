"""add the `drawing` and `textbox` FieldType members (page annotations)

Revision ID: e8b3d5c17a40
Revises: c7a5b2d94f70
Create Date: 2026-09-07

A pen drawing and a text box are the sender's own marks on the page. They are
stored as ordinary `fields` rows so they inherit the geometry validation, the
bulk save and the final-PDF overlay that already exist -- which only needs the
`fieldtype` enum to admit two new members. No column changes.

SQLite renders the enum as a VARCHAR with no constraint, so it needs nothing;
PostgreSQL needs `ALTER TYPE ... ADD VALUE`, which cannot run inside a
transaction block (the same autocommit dance `d2f4a2b6c702` does).
"""
from alembic import op


revision = "e8b3d5c17a40"
down_revision = "c7a5b2d94f70"
branch_labels = None
depends_on = None

NEW_FIELD_TYPES = ("drawing", "textbox")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for value in NEW_FIELD_TYPES:
                op.execute(f"ALTER TYPE fieldtype ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # PostgreSQL cannot remove an enum member. Rows of these types would be
    # orphaned by a downgrade, so they are turned back into plain text fields
    # (the annotation payload in `options` is dropped with them).
    op.execute("UPDATE fields SET type = 'text', options = NULL WHERE type IN ('drawing', 'textbox')")
