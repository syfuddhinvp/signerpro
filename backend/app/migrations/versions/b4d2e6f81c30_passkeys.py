"""passkeys: WebAuthn credentials

Only the public key is stored, which is the point of the scheme: disclosing
this table does not let anyone authenticate as anybody, unlike users.mfa_secret
which is a shared seed that does exactly that.

Revision ID: b4d2e6f81c30
Revises: a3c1d5e79b20
"""

from alembic import op
import sqlalchemy as sa

revision = "b4d2e6f81c30"
down_revision = "a3c1d5e79b20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "passkeys",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("credential_id", sa.String(length=512), nullable=False),
        sa.Column("public_key", sa.String(length=1024), nullable=False),
        sa.Column("sign_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_passkeys_user_id", "passkeys", ["user_id"])
    op.create_index("ix_passkeys_credential_id", "passkeys", ["credential_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_passkeys_credential_id", table_name="passkeys")
    op.drop_index("ix_passkeys_user_id", table_name="passkeys")
    op.drop_table("passkeys")
