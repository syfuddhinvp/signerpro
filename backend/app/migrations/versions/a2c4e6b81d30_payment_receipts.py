"""payment receipts for settled signer payments

PAY-2. A settled `SignerPayment` recorded Stripe's ids and a ``receipt_url``
pointing at a page hosted on the *tenant's connected account* -- evidence
this application neither hosts nor can reproduce, and loses entirely when the
tenant disconnects Stripe. Meanwhile the certificate of completion printed
"Paid". This table gives the tenant a durable, checksummed financial document
of their own for every payment a signer made.

Revision ID: a2c4e6b81d30
Revises: a1b2c3d4e5f6
"""

import sqlalchemy as sa
from alembic import op

revision = "a2c4e6b81d30"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payment_receipts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("signer_payment_id", sa.String(length=36), nullable=False),
        # SET NULL rather than CASCADE: a purged document or an erased
        # recipient must not take the financial record of the money with it.
        # ``document_ref`` and the payer snapshot columns keep the receipt
        # readable afterwards.
        sa.Column("document_id", sa.String(length=36), nullable=True),
        sa.Column("document_ref", sa.String(length=36), nullable=True),
        sa.Column("recipient_id", sa.String(length=36), nullable=True),
        sa.Column("number", sa.String(length=40), nullable=False),
        sa.Column(
            "status",
            sa.Enum("issued", "partially_refunded", "refunded", name="paymentreceiptstatus"),
            nullable=False,
            server_default="issued",
        ),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="USD"),
        sa.Column("subtotal_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tax_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("refunded_amount_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payer_name", sa.String(length=255), nullable=True),
        sa.Column("payer_email", sa.String(length=320), nullable=True),
        sa.Column("document_title", sa.String(length=500), nullable=True),
        sa.Column("issuer_name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("line_items", sa.JSON(), nullable=True),
        sa.Column("provider", sa.String(length=40), nullable=True),
        sa.Column("provider_account_id", sa.String(length=255), nullable=True),
        sa.Column("provider_payment_intent_id", sa.String(length=255), nullable=True),
        sa.Column("provider_charge_id", sa.String(length=255), nullable=True),
        sa.Column("provider_receipt_url", sa.String(length=512), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checksum", sa.String(length=64), nullable=True),
        sa.Column("audit_log_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["signer_payment_id"], ["signer_payments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["recipient_id"], ["recipients.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_payment_receipts_organization_id", "payment_receipts", ["organization_id"])
    op.create_index("ix_payment_receipts_document_id", "payment_receipts", ["document_id"])
    op.create_index("ix_payment_receipts_recipient_id", "payment_receipts", ["recipient_id"])
    op.create_index("ix_payment_receipts_status", "payment_receipts", ["status"])
    op.create_index("ix_payment_receipts_issued_at", "payment_receipts", ["issued_at"])
    # One receipt per settled payment. The settlement path is driven by a
    # webhook Stripe redelivers, so without this a redelivery racing the
    # first delivery would issue a second receipt for the same money.
    op.create_index(
        "uq_payment_receipts_signer_payment_id", "payment_receipts", ["signer_payment_id"], unique=True
    )
    # Numbering is the tenant's own series, hence per-organization.
    op.create_index(
        "uq_payment_receipts_org_number", "payment_receipts", ["organization_id", "number"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_payment_receipts_org_number", table_name="payment_receipts")
    op.drop_index("uq_payment_receipts_signer_payment_id", table_name="payment_receipts")
    op.drop_index("ix_payment_receipts_issued_at", table_name="payment_receipts")
    op.drop_index("ix_payment_receipts_status", table_name="payment_receipts")
    op.drop_index("ix_payment_receipts_recipient_id", table_name="payment_receipts")
    op.drop_index("ix_payment_receipts_document_id", table_name="payment_receipts")
    op.drop_index("ix_payment_receipts_organization_id", table_name="payment_receipts")
    op.drop_table("payment_receipts")
    sa.Enum(name="paymentreceiptstatus").drop(op.get_bind(), checkfirst=True)
