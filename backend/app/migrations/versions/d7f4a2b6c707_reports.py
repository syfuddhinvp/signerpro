"""custom reports, report schedules, report exports

Revision ID: d7f4a2b6c707
Revises: d6f4a2b6c706
Create Date: 2026-08-28
"""
from alembic import op
import sqlalchemy as sa


revision = "d7f4a2b6c707"
down_revision = "d6f4a2b6c706"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("custom_reports"):
        op.create_table(
            "custom_reports",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("fields", sa.JSON(), nullable=False),
            sa.Column("filters", sa.JSON(), nullable=True),
            sa.Column("group_by", sa.String(60), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_custom_reports_organization_id", "custom_reports", ["organization_id"])

    if not _has_table("report_schedules"):
        op.create_table(
            "report_schedules",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("custom_report_id", sa.String(36), sa.ForeignKey("custom_reports.id"), nullable=True),
            sa.Column("report_key", sa.String(40), nullable=True),
            sa.Column("cadence", sa.String(20), nullable=False, server_default="weekly"),
            sa.Column("format", sa.String(10), nullable=False, server_default="csv"),
            sa.Column("recipients", sa.JSON(), nullable=False),
            sa.Column("last_run_at", TIMESTAMP, nullable=True),
            sa.Column("next_run_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_report_schedules_organization_id", "report_schedules", ["organization_id"])

    if not _has_table("report_exports"):
        op.create_table(
            "report_exports",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("requested_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("report_key", sa.String(40), nullable=False),
            sa.Column("range_key", sa.String(10), nullable=True),
            sa.Column("format", sa.String(10), nullable=False, server_default="csv"),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("file_path", sa.String(1024), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_report_exports_organization_id", "report_exports", ["organization_id"])


def downgrade() -> None:
    for table in ("report_exports", "report_schedules", "custom_reports"):
        if _has_table(table):
            op.drop_table(table)
