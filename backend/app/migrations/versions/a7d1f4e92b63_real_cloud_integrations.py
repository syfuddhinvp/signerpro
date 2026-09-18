"""real cloud-storage integrations (OAuth grants + export queue)

The Drive/Dropbox connectors used to be a boolean an endpoint flipped. This
gives them somewhere to keep an actual OAuth grant -- access token, refresh
token, expiry, the remote account's email, and a ``needs_reauth`` latch for a
grant the tenant revoked -- and adds ``cloud_exports``, the durable queue that
pushes each completed PDF to each enabled destination exactly once.

Tokens are written through ``EncryptedString``, so the columns are plain
strings here and hold ciphertext in the database.

Revision ID: a7d1f4e92b63
Revises: c4e6a8b13d52
"""

import sqlalchemy as sa
from alembic import op

revision = "a7d1f4e92b63"
down_revision = "c4e6a8b13d52"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("integrations", sa.Column("account_email", sa.String(length=320), nullable=True))
    op.add_column("integrations", sa.Column("access_token", sa.String(length=6144), nullable=True))
    op.add_column("integrations", sa.Column("refresh_token", sa.String(length=6144), nullable=True))
    op.add_column(
        "integrations", sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "integrations",
        sa.Column("needs_reauth", sa.Boolean(), nullable=False, server_default="0"),
    )
    op.add_column("integrations", sa.Column("last_error", sa.String(length=1000), nullable=True))

    # Rows written by the old fake `/connect` endpoint claim a connection that
    # was never real and carry no tokens, so nothing can be exported through
    # them. Clear the flag rather than delete the row: the label/detail the
    # tenant customised is worth keeping, and the integration simply reads as
    # disconnected until someone completes a genuine OAuth flow.
    op.execute("UPDATE integrations SET connected = false, connected_at = NULL, credentials = NULL")

    op.create_table(
        "cloud_exports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(length=36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            sa.String(length=36),
            sa.ForeignKey("documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("remote_path", sa.String(length=1024), nullable=True),
        sa.Column("remote_file_id", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Exactly-once: completion is reachable by more than one route.
    op.create_index(
        "uq_cloud_exports_document_provider",
        "cloud_exports",
        ["document_id", "provider"],
        unique=True,
    )
    op.create_index("ix_cloud_exports_org_created", "cloud_exports", ["organization_id", "created_at"])
    op.create_index(
        "ix_cloud_exports_status_next_attempt", "cloud_exports", ["status", "next_attempt_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_cloud_exports_status_next_attempt", table_name="cloud_exports")
    op.drop_index("ix_cloud_exports_org_created", table_name="cloud_exports")
    op.drop_index("uq_cloud_exports_document_provider", table_name="cloud_exports")
    op.drop_table("cloud_exports")
    op.drop_column("integrations", "last_error")
    op.drop_column("integrations", "needs_reauth")
    op.drop_column("integrations", "token_expires_at")
    op.drop_column("integrations", "refresh_token")
    op.drop_column("integrations", "access_token")
    op.drop_column("integrations", "account_email")
