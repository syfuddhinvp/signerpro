"""upload a branding logo instead of pasting a URL at one

Revision ID: b5f9c2d81a30
Revises: b3d7e91f4c26
Create Date: 2026-09-11

Asking a tenant for a hosted image URL assumed they had somewhere to host one.
`logo_path` holds a logo uploaded into our own storage; `logo_url` stays for
the tenants and API clients already pointing at their own CDN.
"""
import sqlalchemy as sa
from alembic import op


revision = "b5f9c2d81a30"
down_revision = "b3d7e91f4c26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("branding_themes", sa.Column("logo_path", sa.String(length=1024), nullable=True))


def downgrade() -> None:
    op.drop_column("branding_themes", "logo_path")
