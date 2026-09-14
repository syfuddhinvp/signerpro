"""platform template catalog

Ready-made forms (government, HR, legal) that any tenant can import into its
own template library. Platform-owned, so the table carries no
``organization_id``.

Revision ID: a1b2c3d4e5f6
Revises: c9e1b4a72f80
"""

import sqlalchemy as sa
from alembic import op

revision = "a1b2c3d4e5f6"
down_revision = "c9e1b4a72f80"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalog_templates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=40), nullable=False, server_default="other"),
        sa.Column("authority", sa.String(length=120), nullable=True),
        sa.Column("jurisdiction", sa.String(length=16), nullable=True),
        sa.Column("form_revision", sa.String(length=60), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("file_path", sa.String(length=512), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("roles", sa.JSON(), nullable=True),
        sa.Column("fields", sa.JSON(), nullable=True),
        sa.Column("published", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_catalog_templates_slug", "catalog_templates", ["slug"], unique=True)
    op.create_index("ix_catalog_templates_category", "catalog_templates", ["category"])
    op.create_index("ix_catalog_templates_published", "catalog_templates", ["published"])

    # Where a document came from, when it did not come from an org template.
    # Kept alongside ``source_template_id`` rather than replacing it: the org
    # template is still the document's direct parent, and the catalog entry is
    # the grandparent that explains where that template came from.
    op.add_column("documents", sa.Column("source_catalog_slug", sa.String(length=80), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "source_catalog_slug")
    op.drop_index("ix_catalog_templates_published", table_name="catalog_templates")
    op.drop_index("ix_catalog_templates_category", table_name="catalog_templates")
    op.drop_index("ix_catalog_templates_slug", table_name="catalog_templates")
    op.drop_table("catalog_templates")
