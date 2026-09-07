"""Mark one saved signature per user as the default.

Revision ID: c6f4a1b83e60
Revises: c5e3f7a92d40
"""

import sqlalchemy as sa
from alembic import op

revision = "c6f4a1b83e60"
down_revision = "c5e3f7a92d40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "saved_signatures",
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="0"),
    )
    # Existing accounts already behaved as if their newest signature was the
    # default (the UI read the first row of an adopted_at-sorted list), so
    # promote that row rather than leaving everyone without one.
    op.execute(
        """
        UPDATE saved_signatures SET is_default = true
        WHERE user_id IS NOT NULL AND id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY user_id ORDER BY adopted_at DESC, id
                ) AS rn
                FROM saved_signatures WHERE user_id IS NOT NULL
            ) ranked WHERE rn = 1
        )
        """
    )


def downgrade() -> None:
    op.drop_column("saved_signatures", "is_default")
