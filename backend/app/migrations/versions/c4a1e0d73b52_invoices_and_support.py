"""invoices, support tickets and ticket messages

Revision ID: c4a1e0d73b52
Revises: b7f2c9d41a08
Create Date: 2026-08-28

Activity/logs and revenue need no schema: both are derived from rows the system
already writes (audit_logs, subscriptions, invoices).

Guarded the same way as b7f2c9d41a08 — `0001_initial` runs `create_all` against
live metadata, so a fresh database already has these tables by the time this
revision runs.
"""
from alembic import op
import sqlalchemy as sa


revision = "c4a1e0d73b52"
down_revision = "b7f2c9d41a08"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("invoices"):
        op.create_table(
            "invoices",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("number", sa.String(40), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
            sa.Column("subtotal_cents", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tax_cents", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_cents", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("amount_paid_cents", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("period_start", TIMESTAMP, nullable=True),
            sa.Column("period_end", TIMESTAMP, nullable=True),
            sa.Column("issued_at", TIMESTAMP, nullable=False),
            sa.Column("due_at", TIMESTAMP, nullable=True),
            sa.Column("paid_at", TIMESTAMP, nullable=True),
            sa.Column("line_items", sa.JSON(), nullable=True),
            sa.Column("provider", sa.String(50), nullable=True),
            sa.Column("provider_invoice_id", sa.String(255), nullable=True),
            sa.Column("hosted_url", sa.String(1024), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_invoices_organization_id", "invoices", ["organization_id"])
        op.create_index("ix_invoices_status", "invoices", ["status"])
        op.create_index("ix_invoices_number", "invoices", ["number"], unique=True)

    if not _has_table("support_tickets"):
        op.create_table(
            "support_tickets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("reference", sa.String(30), nullable=False),
            sa.Column("subject", sa.String(255), nullable=False),
            sa.Column("category", sa.String(60), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="open"),
            sa.Column("priority", sa.String(20), nullable=False, server_default="normal"),
            sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("assignee_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("resolved_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
            sa.UniqueConstraint("reference", name="uq_support_tickets_reference"),
        )
        op.create_index("ix_support_tickets_organization_id", "support_tickets", ["organization_id"])
        op.create_index("ix_support_tickets_status", "support_tickets", ["status"])

    if not _has_table("ticket_messages"):
        op.create_table(
            "ticket_messages",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("ticket_id", sa.String(36), sa.ForeignKey("support_tickets.id"), nullable=False),
            sa.Column("author_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("author_name", sa.String(255), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("is_staff", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_ticket_messages_ticket_id", "ticket_messages", ["ticket_id"])


def downgrade() -> None:
    for table in ("ticket_messages", "support_tickets", "invoices"):
        if _has_table(table):
            op.drop_table(table)
