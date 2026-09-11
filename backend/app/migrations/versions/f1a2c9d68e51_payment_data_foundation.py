"""payment data foundation: PaymentAccount, PaymentRequest, SignerPayment (PAY-1)

Revision ID: f1a2c9d68e51
Revises: e5c1a9d24b73
Create Date: 2026-09-11

Lays the data foundation for signers paying the tenant during signing:

- `payment_accounts`: the tenant's connected Stripe account, one row per org.
- `payment_requests`: the envelope-level money ask.
- `signer_payments`: one payment attempt by one recipient.

Also adds the `payment` FieldType enum member, so a payment amount can be
authored as an ordinary field on the canvas. SQLite renders the enum as a
VARCHAR with no constraint, so it needs nothing; PostgreSQL needs
`ALTER TYPE ... ADD VALUE`, which cannot run inside a transaction block (the
same autocommit dance `e8b3d5c17a40` does).
"""
from alembic import op
import sqlalchemy as sa


revision = "f1a2c9d68e51"
down_revision = "e5c1a9d24b73"
branch_labels = None
depends_on = None

NEW_FIELD_TYPES = ("payment",)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for value in NEW_FIELD_TYPES:
                op.execute(f"ALTER TYPE fieldtype ADD VALUE IF NOT EXISTS '{value}'")

    op.create_table(
        "payment_accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False, server_default="stripe"),
        sa.Column("provider_account_id", sa.String(255), nullable=True),
        sa.Column("charges_enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("payouts_enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("details_submitted", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("default_currency", sa.String(3), nullable=True),
        sa.Column("livemode", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("onboarded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_reason", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "uq_payment_accounts_organization_id", "payment_accounts", ["organization_id"], unique=True
    )

    op.create_table(
        "payment_requests",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("total_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("memo", sa.String(255), nullable=True),
        sa.Column(
            "split_mode",
            sa.Enum("single", "equal", "custom", name="paymentsplitmode"),
            nullable=False,
            server_default="single",
        ),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_payment_requests_document_id", "payment_requests", ["document_id"])
    op.create_index("ix_payment_requests_organization_id", "payment_requests", ["organization_id"])

    op.create_table(
        "signer_payments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_id", sa.String(36), sa.ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("field_id", sa.String(36), sa.ForeignKey("fields.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "payment_request_id",
            sa.String(36),
            sa.ForeignKey("payment_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column(
            "status",
            sa.Enum(
                "requires_payment", "processing", "succeeded", "failed", "refunded", name="signerpaymentstatus"
            ),
            nullable=False,
            server_default="requires_payment",
        ),
        sa.Column("provider", sa.String(40), nullable=True),
        sa.Column("provider_payment_intent_id", sa.String(255), nullable=True),
        sa.Column("provider_account_id", sa.String(255), nullable=True),
        sa.Column("provider_charge_id", sa.String(255), nullable=True),
        sa.Column("receipt_url", sa.String(512), nullable=True),
        sa.Column("failure_code", sa.String(60), nullable=True),
        sa.Column("failure_message", sa.String(255), nullable=True),
        sa.Column("idempotency_key", sa.String(80), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_amount_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("description", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_signer_payments_organization_id", "signer_payments", ["organization_id"])
    op.create_index("ix_signer_payments_document_id", "signer_payments", ["document_id"])
    op.create_index("ix_signer_payments_recipient_id", "signer_payments", ["recipient_id"])
    op.create_index("ix_signer_payments_field_id", "signer_payments", ["field_id"])
    op.create_index("ix_signer_payments_payment_request_id", "signer_payments", ["payment_request_id"])
    op.create_index("ix_signer_payments_status", "signer_payments", ["status"])
    op.create_index(
        "uq_signer_payments_provider_payment_intent_id",
        "signer_payments",
        ["provider_payment_intent_id"],
        unique=True,
    )
    op.create_index(
        "uq_signer_payments_idempotency_key", "signer_payments", ["idempotency_key"], unique=True
    )


def downgrade() -> None:
    op.drop_table("signer_payments")
    op.drop_table("payment_requests")
    op.drop_table("payment_accounts")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS signerpaymentstatus")
        op.execute("DROP TYPE IF EXISTS paymentsplitmode")

    # PostgreSQL cannot remove an enum member. Rows of this type would be
    # orphaned by a downgrade, so they are turned back into plain text fields
    # (the payment config in `options` is dropped with them).
    op.execute("UPDATE fields SET type = 'text', options = NULL WHERE type = 'payment'")
