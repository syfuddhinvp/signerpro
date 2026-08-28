"""user sessions, password reset tokens, saved signatures, user profile/MFA columns

Revision ID: d3f4a2b6c703
Revises: d2f4a2b6c702
Create Date: 2026-08-28
"""
from alembic import op
import sqlalchemy as sa


revision = "d3f4a2b6c703"
down_revision = "d2f4a2b6c702"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table: str) -> set[str]:
    if not _has_table(table):
        return set()
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set[str]:
    if not _has_table(table):
        return set()
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def _add_column(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    if not _has_table("user_sessions"):
        op.create_table(
            "user_sessions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("refresh_token_hash", sa.String(64), nullable=False),
            sa.Column("device", sa.String(120), nullable=True),
            sa.Column("browser", sa.String(80), nullable=True),
            sa.Column("os", sa.String(80), nullable=True),
            sa.Column("ip_address", sa.String(80), nullable=True),
            sa.Column("location", sa.String(120), nullable=True),
            sa.Column("user_agent", sa.String(512), nullable=True),
            sa.Column("last_seen_at", TIMESTAMP, nullable=False),
            sa.Column("expires_at", TIMESTAMP, nullable=False),
            sa.Column("revoked_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"])
        op.create_index("ix_user_sessions_refresh_hash", "user_sessions", ["refresh_token_hash"], unique=True)

    if not _has_table("password_reset_tokens"):
        op.create_table(
            "password_reset_tokens",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("expires_at", TIMESTAMP, nullable=False),
            sa.Column("used_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index(
            "ix_password_reset_tokens_token_hash", "password_reset_tokens", ["token_hash"], unique=True
        )
        op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])

    if not _has_table("saved_signatures"):
        op.create_table(
            "saved_signatures",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("recipient_email", sa.String(320), nullable=True),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("signature_type", sa.String(20), nullable=False, server_default="drawn"),
            sa.Column("signature_text", sa.String(255), nullable=True),
            sa.Column("type_face", sa.String(60), nullable=True),
            sa.Column("image_path", sa.String(1024), nullable=True),
            sa.Column("is_passkey_bound", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("adopted_at", TIMESTAMP, nullable=False),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_saved_signatures_user_id", "saved_signatures", ["user_id"])
        op.create_index("ix_saved_signatures_recipient_email", "saved_signatures", ["recipient_email"])

    _add_column("users", sa.Column("mfa_method", sa.String(20), nullable=True))
    _add_column("users", sa.Column("mfa_secret", sa.String(255), nullable=True))
    _add_column("users", sa.Column("mfa_enrolled_at", TIMESTAMP, nullable=True))
    _add_column("users", sa.Column("mfa_recovery_codes", sa.JSON(), nullable=True))
    _add_column("users", sa.Column("last_active_at", TIMESTAMP, nullable=True))
    _add_column("users", sa.Column("locale", sa.String(20), nullable=True))
    _add_column("users", sa.Column("timezone", sa.String(60), nullable=True))
    _add_column("users", sa.Column("avatar_url", sa.String(1024), nullable=True))
    _add_column("users", sa.Column("status", sa.String(20), nullable=False, server_default="active"))
    _add_column("users", sa.Column("preferences", sa.JSON(), nullable=True))


def downgrade() -> None:
    for column in (
        "preferences",
        "status",
        "avatar_url",
        "timezone",
        "locale",
        "last_active_at",
        "mfa_recovery_codes",
        "mfa_enrolled_at",
        "mfa_secret",
        "mfa_method",
    ):
        if column in _columns("users"):
            op.drop_column("users", column)
    for table in ("saved_signatures", "password_reset_tokens", "user_sessions"):
        if _has_table(table):
            op.drop_table(table)
