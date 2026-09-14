"""platform admin console IP allowlist

Revision ID: a1c2d3e4f5b6
Revises: f9c2d3e4a5b1
Create Date: 2026-09-07

Backs the ``ipAllow`` security-posture control with an actual list of CIDR
ranges. An empty table is not a lockout: ``require_platform_admin`` only
enforces the allowlist when the posture row is enabled *and* this table is
non-empty.
"""
import sqlalchemy as sa
from alembic import op


revision = "a1c2d3e4f5b6"
down_revision = "f9c2d3e4a5b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_ip_allowlist",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("cidr", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_platform_ip_allowlist_cidr", "platform_ip_allowlist", ["cidr"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_platform_ip_allowlist_cidr", table_name="platform_ip_allowlist")
    op.drop_table("platform_ip_allowlist")
