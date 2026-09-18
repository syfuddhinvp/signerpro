"""wallet accounts and append-only balance ledger

BIL-12. A plan downgrade, a mid-period interval switch and a seat release all
hand back time or capacity the tenant had already paid for. Every one of them
previously discarded that value silently: the proration was computed, found to
be negative, and dropped. These tables hold it as application credit that the
next invoice draws down. Deliberately no payout path -- see
`app/models/wallet.py`.

Revision ID: b3d5f7a92c41
Revises: a2c4e6b81d30
"""

import sqlalchemy as sa
from alembic import op

revision = "b3d5f7a92c41"
down_revision = "a2c4e6b81d30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "wallet_accounts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="USD"),
        sa.Column("balance_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_wallet_accounts_organization_id", "wallet_accounts", ["organization_id"], unique=True
    )

    op.create_table(
        "wallet_entries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("wallet_account_id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("balance_after_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="USD"),
        sa.Column(
            "kind",
            sa.Enum(
                "downgrade_proration",
                "interval_switch_remainder",
                "seat_reduction",
                "overpayment",
                "platform_grant",
                "invoice_payment",
                "reversal",
                name="walletentrykind",
            ),
            nullable=False,
        ),
        sa.Column("description", sa.String(length=255), nullable=False),
        # SET NULL: a voided invoice must not delete the record of the
        # balance it consumed.
        sa.Column("invoice_id", sa.String(length=36), nullable=True),
        sa.Column("charge_id", sa.String(length=36), nullable=True),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("idempotency_key", sa.String(length=255), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["wallet_account_id"], ["wallet_accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_wallet_entries_account_created",
        "wallet_entries",
        ["wallet_account_id", "created_at"],
    )
    op.create_index("ix_wallet_entries_organization_id", "wallet_entries", ["organization_id"])
    op.create_index("ix_wallet_entries_invoice_id", "wallet_entries", ["invoice_id"])
    # The credit paths are driven by webhooks and by buttons a user can
    # double-click, so replay protection is a correctness requirement rather
    # than a defensive nicety: a credit applied twice is money invented.
    op.create_index(
        "uq_wallet_entries_idempotency_key", "wallet_entries", ["idempotency_key"], unique=True
    )


def downgrade() -> None:
    op.drop_index("uq_wallet_entries_idempotency_key", table_name="wallet_entries")
    op.drop_index("ix_wallet_entries_invoice_id", table_name="wallet_entries")
    op.drop_index("ix_wallet_entries_organization_id", table_name="wallet_entries")
    op.drop_index("ix_wallet_entries_account_created", table_name="wallet_entries")
    op.drop_table("wallet_entries")
    op.drop_index("uq_wallet_accounts_organization_id", table_name="wallet_accounts")
    op.drop_table("wallet_accounts")
    sa.Enum(name="walletentrykind").drop(op.get_bind(), checkfirst=True)
