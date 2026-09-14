"""let a tenant choose which field types its builder palette offers

Revision ID: a2d4f6b8c910
Revises: f1a2c9d68e51
Create Date: 2026-09-11

The palette offers every `FieldType` there is, which is more than most tenants
ever place. `organizations.enabled_field_types` narrows it: NULL keeps the full
palette (so every existing tenant is unchanged by this migration), and a JSON
list restricts authoring to exactly those types.

Authoring only -- fields already on a document or template are untouched.
"""
import sqlalchemy as sa
from alembic import op


revision = "a2d4f6b8c910"
down_revision = "f1a2c9d68e51"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("enabled_field_types", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "enabled_field_types")
