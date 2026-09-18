"""give certifications the evidence that makes a status mean something

A row saying "certified" with nothing behind it can be shown to a customer as
proof of an audit that never happened. These columns record who issued the
attestation, when it was issued, when it lapses and where the report lives —
the API refuses to store ``certified`` without them.

Revision ID: f3a7c1d84b92
Revises: a7d1f4e92b63
"""

import sqlalchemy as sa
from alembic import op

revision = "f3a7c1d84b92"
down_revision = "a7d1f4e92b63"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("auditor", sa.String(length=160)),
    ("assessed_on", sa.Date()),
    ("expires_on", sa.Date()),
    ("evidence_url", sa.String(length=500)),
    ("notes", sa.Text()),
    ("updated_by_user_id", sa.String(length=36)),
)


def _existing() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {col["name"] for col in inspector.get_columns("certifications")}


def upgrade() -> None:
    present = _existing()
    with op.batch_alter_table("certifications") as batch:
        for name, type_ in _COLUMNS:
            if name not in present:
                batch.add_column(sa.Column(name, type_, nullable=True))
        batch.alter_column(
            "status",
            existing_type=sa.String(length=20),
            existing_nullable=False,
            server_default="not_assessed",
        )
    # The seeded default moved from "certified" to "not_assessed"; existing
    # deployments carry rows minted under the old default that assert audits
    # nobody performed. Nothing has evidence yet, so none of them can stand.
    op.execute("UPDATE certifications SET status = 'not_assessed' WHERE status = 'certified'")


def downgrade() -> None:
    present = _existing()
    with op.batch_alter_table("certifications") as batch:
        for name, _type in _COLUMNS:
            if name in present:
                batch.drop_column(name)
        batch.alter_column(
            "status",
            existing_type=sa.String(length=20),
            existing_nullable=False,
            server_default="certified",
        )
