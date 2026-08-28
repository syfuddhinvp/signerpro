"""payment methods, charges, plan marketing columns, invoice + webhook-event extras, org billing settings

Revision ID: d5f4a2b6c705
Revises: d4f4a2b6c704
Create Date: 2026-08-28

`UsageEventType` and `InvoiceStatus` are plain String columns, so the new
members (`api_call`, `sms_sent`, `past_due`) need no DDL.
"""
from alembic import op
import sqlalchemy as sa


revision = "d5f4a2b6c705"
down_revision = "d4f4a2b6c704"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    if not _has_table(table):
        return set()
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    if not _has_table("payment_methods"):
        op.create_table(
            "payment_methods",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("type", sa.String(20), nullable=False, server_default="card"),
            sa.Column("brand", sa.String(30), nullable=True),
            sa.Column("last4", sa.String(4), nullable=True),
            sa.Column("exp_month", sa.Integer(), nullable=True),
            sa.Column("exp_year", sa.Integer(), nullable=True),
            sa.Column("holder_name", sa.String(255), nullable=True),
            sa.Column("country", sa.String(2), nullable=True),
            sa.Column("label", sa.String(120), nullable=False, server_default=""),
            sa.Column("meta", sa.String(255), nullable=True),
            sa.Column("po_number", sa.String(60), nullable=True),
            sa.Column("provider", sa.String(50), nullable=True),
            sa.Column("provider_payment_method_id", sa.String(255), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_payment_methods_organization_id", "payment_methods", ["organization_id"])

    if not _has_table("charges"):
        op.create_table(
            "charges",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("invoice_id", sa.String(36), sa.ForeignKey("invoices.id"), nullable=True),
            sa.Column("amount_cents", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
            sa.Column("status", sa.String(20), nullable=False, server_default="succeeded"),
            sa.Column("provider", sa.String(50), nullable=True),
            sa.Column("provider_payment_id", sa.String(255), nullable=True),
            sa.Column("method_label", sa.String(80), nullable=True),
            sa.Column("decline_code", sa.String(60), nullable=True),
            sa.Column("dunning_step", sa.Integer(), nullable=True),
            sa.Column("next_attempt_at", TIMESTAMP, nullable=True),
            sa.Column("description", sa.String(255), nullable=True),
            sa.Column("occurred_at", TIMESTAMP, nullable=False),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_charges_organization_id", "charges", ["organization_id"])
        op.create_index("ix_charges_status", "charges", ["status"])

    _add_column("plans", sa.Column("tag", sa.String(60), nullable=True))
    _add_column("plans", sa.Column("marketing_lines", sa.JSON(), nullable=True))
    _add_column("plans", sa.Column("seat_price_cents", sa.Integer(), nullable=True))
    _add_column("plans", sa.Column("is_seat_based", sa.Boolean(), nullable=False, server_default=sa.false()))

    _add_column("invoices", sa.Column("provider_payment_intent_id", sa.String(255), nullable=True))
    _add_column("invoices", sa.Column("payment_method_label", sa.String(80), nullable=True))
    _add_column("invoices", sa.Column("period_label", sa.String(30), nullable=True))

    _add_column("billing_webhook_events", sa.Column("status_code", sa.Integer(), nullable=True))
    _add_column(
        "billing_webhook_events",
        sa.Column("processed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    _add_column("billing_webhook_events", sa.Column("error", sa.Text(), nullable=True))

    _add_column("organizations", sa.Column("autopay", sa.Boolean(), nullable=False, server_default=sa.true()))
    _add_column("organizations", sa.Column("billing_email", sa.String(320), nullable=True))
    _add_column("organizations", sa.Column("tax_id", sa.String(60), nullable=True))
    _add_column(
        "organizations", sa.Column("billing_cycle", sa.String(20), nullable=False, server_default="monthly")
    )
    _add_column("organizations", sa.Column("default_payment_method_id", sa.String(36), nullable=True))


def downgrade() -> None:
    for column in (
        "default_payment_method_id",
        "billing_cycle",
        "tax_id",
        "billing_email",
        "autopay",
    ):
        if column in _columns("organizations"):
            op.drop_column("organizations", column)
    for column in ("error", "processed", "status_code"):
        if column in _columns("billing_webhook_events"):
            op.drop_column("billing_webhook_events", column)
    for column in ("period_label", "payment_method_label", "provider_payment_intent_id"):
        if column in _columns("invoices"):
            op.drop_column("invoices", column)
    for column in ("is_seat_based", "seat_price_cents", "marketing_lines", "tag"):
        if column in _columns("plans"):
            op.drop_column("plans", column)
    for table in ("charges", "payment_methods"):
        if _has_table(table):
            op.drop_table(table)
