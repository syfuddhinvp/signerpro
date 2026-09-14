"""SCIM 2.0 provisioning tokens

Revision ID: b2c3d4e5f6a7
Revises: a1c2d3e4f5b6
Create Date: 2026-09-07

Backs the ``scim`` security-posture control. Only a SHA-256 hash of the
bearer token is stored, mirroring ``api_keys``.
"""
import sqlalchemy as sa
from alembic import op


revision = "b2c3d4e5f6a7"
down_revision = "a1c2d3e4f5b6"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "scim_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(120), nullable=False, server_default="SCIM provisioning"),
        sa.Column("prefix", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_used_at", TIMESTAMP, nullable=True),
        sa.Column("revoked_at", TIMESTAMP, nullable=True),
        sa.Column("created_at", TIMESTAMP, nullable=False),
        sa.Column("updated_at", TIMESTAMP, nullable=False),
    )
    op.create_index("ix_scim_tokens_organization_id", "scim_tokens", ["organization_id"])
    op.create_index("ix_scim_tokens_token_hash", "scim_tokens", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_scim_tokens_token_hash", table_name="scim_tokens")
    op.drop_index("ix_scim_tokens_organization_id", table_name="scim_tokens")
    op.drop_table("scim_tokens")
