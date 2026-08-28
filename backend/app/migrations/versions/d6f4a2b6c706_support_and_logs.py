"""support ticket extras, system logs, notifications, integrations, cloud targets

Revision ID: d6f4a2b6c706
Revises: d5f4a2b6c705
Create Date: 2026-08-28

`TicketStatus` is a plain String(20), so the new `escalated` member needs no
DDL. `teams`/`team_members` were created in d1f4a2b6c701 because
`folders.team_id` references them.
"""
from alembic import op
import sqlalchemy as sa


revision = "d6f4a2b6c706"
down_revision = "d5f4a2b6c705"
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
    _add_column("support_tickets", sa.Column("document_id", sa.String(36), nullable=True))
    _add_column("support_tickets", sa.Column("tags", sa.JSON(), nullable=True))
    _add_column("support_tickets", sa.Column("sla_due_at", TIMESTAMP, nullable=True))
    _add_column("support_tickets", sa.Column("requester_name", sa.String(255), nullable=True))
    _add_column("support_tickets", sa.Column("requester_email", sa.String(320), nullable=True))
    _add_column(
        "ticket_messages", sa.Column("is_internal", sa.Boolean(), nullable=False, server_default=sa.false())
    )

    if not _has_table("system_logs"):
        op.create_table(
            "system_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=True),
            sa.Column("occurred_at", TIMESTAMP, nullable=False),
            sa.Column("level", sa.String(10), nullable=False, server_default="info"),
            sa.Column("source", sa.String(20), nullable=False, server_default="api"),
            sa.Column("message", sa.String(1024), nullable=False),
            sa.Column("status_code", sa.Integer(), nullable=True),
            sa.Column("latency_ms", sa.Integer(), nullable=True),
            sa.Column("request_id", sa.String(64), nullable=True),
            sa.Column("actor_email", sa.String(320), nullable=True),
            sa.Column("ip_address", sa.String(80), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=True),
        )
        op.create_index("ix_system_logs_occurred_at", "system_logs", ["occurred_at"])
        op.create_index(
            "ix_system_logs_org_source_level", "system_logs", ["organization_id", "source", "level"]
        )

    if not _has_table("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("detail", sa.String(512), nullable=True),
            sa.Column("tone", sa.String(10), nullable=False, server_default="info"),
            sa.Column("screen", sa.String(40), nullable=True),
            sa.Column("target_id", sa.String(64), nullable=True),
            sa.Column("read_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_notifications_user_unread", "notifications", ["user_id", "read_at"])

    if not _has_table("notification_preferences"):
        op.create_table(
            "notification_preferences",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("event_key", sa.String(60), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("extra_recipients", sa.JSON(), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("uq_notif_pref", "notification_preferences", ["user_id", "event_key"], unique=True)

    if not _has_table("integrations"):
        op.create_table(
            "integrations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("provider", sa.String(40), nullable=False),
            sa.Column("label", sa.String(80), nullable=False),
            sa.Column("detail", sa.String(255), nullable=True),
            sa.Column("connected", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("connected_at", TIMESTAMP, nullable=True),
            sa.Column("credentials", sa.String(2048), nullable=True),
            sa.Column("config", sa.JSON(), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index(
            "uq_integrations_org_provider", "integrations", ["organization_id", "provider"], unique=True
        )

    if not _has_table("cloud_targets"):
        op.create_table(
            "cloud_targets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("provider", sa.String(40), nullable=False),
            sa.Column("path", sa.String(512), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index(
            "uq_cloud_targets_org_provider", "cloud_targets", ["organization_id", "provider"], unique=True
        )


def downgrade() -> None:
    for table in (
        "cloud_targets",
        "integrations",
        "notification_preferences",
        "notifications",
        "system_logs",
    ):
        if _has_table(table):
            op.drop_table(table)
    if "is_internal" in _columns("ticket_messages"):
        op.drop_column("ticket_messages", "is_internal")
    for column in ("requester_email", "requester_name", "sla_due_at", "tags", "document_id"):
        if column in _columns("support_tickets"):
            op.drop_column("support_tickets", column)
