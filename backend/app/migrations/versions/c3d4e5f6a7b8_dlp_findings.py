"""document DLP findings

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-07

Backs the "dlp" security-posture row (FLG-5): one row per pattern type per
document, holding only a type, a count, and offsets into the extracted
text -- never the matched value itself.
"""
import sqlalchemy as sa
from alembic import op


revision = "c3d4e5f6a7b8"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_dlp_findings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("document_id", sa.String(length=36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pattern_type", sa.String(length=40), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("offsets", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_document_dlp_findings_document_id", "document_dlp_findings", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_document_dlp_findings_document_id", table_name="document_dlp_findings")
    op.drop_table("document_dlp_findings")
