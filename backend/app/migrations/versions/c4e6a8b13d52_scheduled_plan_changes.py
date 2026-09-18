"""scheduled (period-end) plan changes

BIL-12. A downgrade used to apply the moment it was requested, taking away
capacity the tenant had already paid for through ``current_period_end`` and
discarding the difference. These columns let the change be *scheduled*: the
subscription keeps its plan until the period it paid for actually ends, and
``run_renewals`` applies the pending plan before cutting the renewal invoice.

Also adds ``invoices.idempotency_key``: the upgrade path issues an invoice in
response to a button, and a double-click used to issue and collect two.

Revision ID: c4e6a8b13d52
Revises: b3d5f7a92c41
"""

import sqlalchemy as sa
from alembic import op

revision = "c4e6a8b13d52"
down_revision = "b3d5f7a92c41"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("subscriptions", sa.Column("pending_plan_id", sa.String(length=36), nullable=True))
    op.add_column(
        "subscriptions",
        sa.Column("pending_plan_effective_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "subscriptions",
        sa.Column("pending_plan_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    # RESTRICT, matching ``plan_id``: a plan an organization is scheduled onto
    # must not be deletable out from under them.
    op.create_foreign_key(
        "fk_subscriptions_pending_plan_id",
        "subscriptions",
        "plans",
        ["pending_plan_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    # The renewal driver sweeps by effective date, so it is the indexed column
    # rather than the plan.
    op.create_index(
        "ix_subscriptions_pending_plan_effective_at",
        "subscriptions",
        ["pending_plan_effective_at"],
    )

    op.add_column("invoices", sa.Column("idempotency_key", sa.String(length=255), nullable=True))
    op.create_index("uq_invoices_idempotency_key", "invoices", ["idempotency_key"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_invoices_idempotency_key", table_name="invoices")
    op.drop_column("invoices", "idempotency_key")
    op.drop_index("ix_subscriptions_pending_plan_effective_at", table_name="subscriptions")
    op.drop_constraint("fk_subscriptions_pending_plan_id", "subscriptions", type_="foreignkey")
    op.drop_column("subscriptions", "pending_plan_requested_at")
    op.drop_column("subscriptions", "pending_plan_effective_at")
    op.drop_column("subscriptions", "pending_plan_id")
