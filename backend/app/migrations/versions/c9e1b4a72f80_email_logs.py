"""platform mail outbox

Revision ID: c9e1b4a72f80
Revises: b5f9c2d81a30
Create Date: 2026-09-12

One row per outbound message, written by the email gateway itself. Bodies are
stored with bearer links and one-time codes masked, so the outbox is a record
of what was sent rather than a store of live credentials.
"""
import sqlalchemy as sa
from alembic import op


revision = "c9e1b4a72f80"
down_revision = "b5f9c2d81a30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_logs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("organization_id", sa.String(length=36), sa.ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("to_email", sa.String(length=320), nullable=False),
        sa.Column("from_email", sa.String(length=320), nullable=True),
        sa.Column("subject", sa.String(length=512), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=True),
        sa.Column("category", sa.String(length=20), nullable=False, server_default="system"),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="sent"),
        sa.Column("provider", sa.String(length=12), nullable=False, server_default="console"),
        sa.Column("error", sa.String(length=1024), nullable=True),
        sa.Column("document_id", sa.String(length=36), sa.ForeignKey("documents.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sent_by_user_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_email_logs_created_at", "email_logs", ["created_at"])
    op.create_index(
        "ix_email_logs_org_category_status",
        "email_logs",
        ["organization_id", "category", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_email_logs_org_category_status", table_name="email_logs")
    op.drop_index("ix_email_logs_created_at", table_name="email_logs")
    op.drop_table("email_logs")
