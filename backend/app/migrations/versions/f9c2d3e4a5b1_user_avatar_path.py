"""store an uploaded profile photo alongside the external avatar URL

Revision ID: f9c2d3e4a5b1
Revises: e8b3d5c17a40
Create Date: 2026-09-07

`users.avatar_url` holds whatever an identity provider handed us -- an absolute
URL we do not own. A photo the user uploads here lives in our storage instead,
so it needs a key rather than a URL: `avatar_path`. The two coexist, and the
uploaded one wins when both are set (see `AuthService.user_payload`).
"""
import sqlalchemy as sa
from alembic import op


revision = "f9c2d3e4a5b1"
down_revision = "e8b3d5c17a40"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_path", sa.String(length=1024), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_path")
