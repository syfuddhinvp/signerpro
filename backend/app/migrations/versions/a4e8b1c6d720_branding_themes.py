"""named sender branding themes, chosen per envelope

Revision ID: a4e8b1c6d720
Revises: a2d4f6b8c910
Create Date: 2026-09-11

A tenant that sends under more than one brand could not say so: branding was
two columns on `organizations`, so every envelope looked the same. This adds
`branding_themes` and points a document at one. A NULL on the document means
the tenant's default theme, resolved at read time rather than copied, so
editing the default re-brands the drafts that never chose their own.
"""
import sqlalchemy as sa
from alembic import op


revision = "a4e8b1c6d720"
down_revision = "a2d4f6b8c910"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "branding_themes",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(length=36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("logo_url", sa.String(length=1024), nullable=True),
        sa.Column("logo_position", sa.String(length=10), nullable=False, server_default="left"),
        sa.Column("primary_color", sa.String(length=9), nullable=True),
        sa.Column("primary_text_color", sa.String(length=9), nullable=True),
        sa.Column("headline", sa.String(length=255), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("contact_sender_email", sa.String(length=320), nullable=True),
        sa.Column("footer_signature", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_branding_themes_organization_id", "branding_themes", ["organization_id"])
    op.create_index(
        "uq_branding_themes_org_name", "branding_themes", ["organization_id", "name"], unique=True
    )

    # Batch mode so SQLite can add a column that carries a foreign key.
    with op.batch_alter_table("documents") as batch:
        batch.add_column(sa.Column("branding_theme_id", sa.String(length=36), nullable=True))
        batch.create_foreign_key(
            "fk_documents_branding_theme_id",
            "branding_themes",
            ["branding_theme_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.drop_constraint("fk_documents_branding_theme_id", type_="foreignkey")
        batch.drop_column("branding_theme_id")
    op.drop_index("uq_branding_themes_org_name", table_name="branding_themes")
    op.drop_index("ix_branding_themes_organization_id", table_name="branding_themes")
    op.drop_table("branding_themes")
