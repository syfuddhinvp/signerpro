"""drop fields.merge_tag and retire the `formula` FieldType

Revision ID: c7a5b2d94f70
Revises: c6f4a1b83e60
Create Date: 2026-09-07

Merge tags existed for exactly one consumer: a `formula` field referenced other
fields by tag so the server could compute a total from them. With the tags gone
a calculated field has nothing to reference, so the type goes too rather than
staying in the palette as an `fx` badge over a value that is always blank --
which is the state it was withdrawn from the palette for once already.

Existing `formula` rows become plain `text` fields with their options cleared:
their expression can no longer be evaluated, and leaving the value stamped as
though it were still derived would misrepresent an executed contract. A row
left reading "formula" would also fail to load at all, the Python enum no
longer having that member.

PostgreSQL cannot drop a member from an ENUM in place, so `fieldtype` keeps an
unused `formula` value -- the same compromise `d2f4a2b6c702` documents in the
other direction. Nothing writes it.
"""
from alembic import op
import sqlalchemy as sa


revision = "c7a5b2d94f70"
down_revision = "c6f4a1b83e60"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    columns = _columns("fields")
    if not columns:
        return
    op.execute(sa.text("UPDATE fields SET type = 'text', options = NULL WHERE type = 'formula'"))
    if "merge_tag" in columns:
        op.drop_column("fields", "merge_tag")


def downgrade() -> None:
    columns = _columns("fields")
    if columns and "merge_tag" not in columns:
        op.add_column("fields", sa.Column("merge_tag", sa.String(120), nullable=True))
    # The fields that were calculated are text fields now; which ones they were
    # is not recorded, so there is nothing to restore them from.
