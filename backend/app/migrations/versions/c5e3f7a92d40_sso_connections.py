"""sso_connections: per-tenant SAML identity provider

allowed_email_domains is the tenant-isolation boundary, not a convenience: a
SAML assertion is XML the IdP signed, and nothing in the protocol stops one
customer's IdP asserting another customer's address.

Revision ID: c5e3f7a92d40
Revises: b4d2e6f81c30
"""

from alembic import op
import sqlalchemy as sa

revision = "c5e3f7a92d40"
down_revision = "b4d2e6f81c30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sso_connections",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("idp_entity_id", sa.String(length=512), nullable=False),
        sa.Column("idp_sso_url", sa.String(length=1024), nullable=False),
        # Encrypted at rest, so the column is sized for ciphertext.
        sa.Column("idp_x509_cert", sa.String(length=24576), nullable=False),
        sa.Column("allowed_email_domains", sa.String(length=1024), nullable=False),
        sa.Column("enforced", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("auto_provision", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_sso_connections_organization_id", "sso_connections", ["organization_id"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_sso_connections_organization_id", table_name="sso_connections")
    op.drop_table("sso_connections")
