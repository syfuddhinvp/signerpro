"""paired sandbox organizations

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-09-08

A sandbox is a shadow ``organizations`` row rather than a discriminator column
on twenty-odd tables: every query in the app is already scoped by
``organization_id``, so pairing gives isolation with no query changes and no
way to leak live data through a filter someone forgot to add.

Existing rows are live (``is_sandbox`` false, ``sandbox_of_organization_id``
null), which is why both columns carry server defaults.
"""
import sqlalchemy as sa
from alembic import op


revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("is_sandbox", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column(
        "organizations",
        sa.Column("sandbox_of_organization_id", sa.String(length=36), nullable=True),
    )
    # One sandbox per live organization; the partial-index equivalent is
    # enforced in the service, but the lookup itself needs to be fast.
    op.create_index(
        "ix_organizations_sandbox_of",
        "organizations",
        ["sandbox_of_organization_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_organizations_sandbox_of", table_name="organizations")
    op.drop_column("organizations", "sandbox_of_organization_id")
    op.drop_column("organizations", "is_sandbox")
