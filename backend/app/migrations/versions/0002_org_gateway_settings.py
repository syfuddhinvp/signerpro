"""org gateway settings

Revision ID: 0002_org_gateway_settings
Revises: 0001_initial
Create Date: 2026-05-24
"""
import sqlalchemy as sa
from alembic import op


revision = "0002_org_gateway_settings"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [c["name"] for c in inspector.get_columns("organizations")]

    if "smtp_host" not in columns:
        op.add_column("organizations", sa.Column("smtp_host", sa.String(255), nullable=True))
    if "smtp_port" not in columns:
        op.add_column("organizations", sa.Column("smtp_port", sa.Integer(), nullable=True))
    if "smtp_username" not in columns:
        op.add_column("organizations", sa.Column("smtp_username", sa.String(255), nullable=True))
    if "smtp_password" not in columns:
        op.add_column("organizations", sa.Column("smtp_password", sa.String(255), nullable=True))
    if "smtp_from_email" not in columns:
        op.add_column("organizations", sa.Column("smtp_from_email", sa.String(255), nullable=True))
    if "sms_provider" not in columns:
        op.add_column("organizations", sa.Column("sms_provider", sa.String(50), nullable=True))
    if "twilio_account_sid" not in columns:
        op.add_column("organizations", sa.Column("twilio_account_sid", sa.String(255), nullable=True))
    if "twilio_auth_token" not in columns:
        op.add_column("organizations", sa.Column("twilio_auth_token", sa.String(255), nullable=True))
    if "twilio_from_number" not in columns:
        op.add_column("organizations", sa.Column("twilio_from_number", sa.String(50), nullable=True))
    if "telnyx_api_key" not in columns:
        op.add_column("organizations", sa.Column("telnyx_api_key", sa.String(255), nullable=True))
    if "telnyx_from_number" not in columns:
        op.add_column("organizations", sa.Column("telnyx_from_number", sa.String(50), nullable=True))


def downgrade() -> None:
    from sqlalchemy import inspect
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = [c["name"] for c in inspector.get_columns("organizations")]

    if "telnyx_from_number" in columns:
        op.drop_column("organizations", "telnyx_from_number")
    if "telnyx_api_key" in columns:
        op.drop_column("organizations", "telnyx_api_key")
    if "twilio_from_number" in columns:
        op.drop_column("organizations", "twilio_from_number")
    if "twilio_auth_token" in columns:
        op.drop_column("organizations", "twilio_auth_token")
    if "twilio_account_sid" in columns:
        op.drop_column("organizations", "twilio_account_sid")
    if "sms_provider" in columns:
        op.drop_column("organizations", "sms_provider")
    if "smtp_from_email" in columns:
        op.drop_column("organizations", "smtp_from_email")
    if "smtp_password" in columns:
        op.drop_column("organizations", "smtp_password")
    if "smtp_username" in columns:
        op.drop_column("organizations", "smtp_username")
    if "smtp_port" in columns:
        op.drop_column("organizations", "smtp_port")
    if "smtp_host" in columns:
        op.drop_column("organizations", "smtp_host")
