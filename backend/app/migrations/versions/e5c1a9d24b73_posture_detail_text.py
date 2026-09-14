"""widen security_posture.detail to TEXT

The posture rows describe, in full sentences, what each control enforces and
what it does not. Three of the six defaults exceed 255 characters, so seeding
them raised a DataError on Postgres and the whole seed rolled back — leaving
the platform console with an empty security-posture panel.

Revision ID: e5c1a9d24b73
Revises: d4e5f6a7b8c9
"""

import sqlalchemy as sa
from alembic import op

revision = "e5c1a9d24b73"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return
    op.alter_column(
        "security_posture",
        "detail",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return
    # Truncate first: rows written under TEXT may not fit the old cap.
    op.execute("UPDATE security_posture SET detail = left(detail, 255)")
    op.alter_column(
        "security_posture",
        "detail",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
