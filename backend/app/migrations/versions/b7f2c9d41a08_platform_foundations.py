"""platform foundations: platform admin, invitations, plans/billing, webhooks, otp hardening

Revision ID: b7f2c9d41a08
Revises: 605d934325de
Create Date: 2026-08-27

Consolidates the Phase 1/2/3/4 schema changes.

Note on the guards below: ``0001_initial`` runs ``Base.metadata.create_all`` against
live model metadata, so a *fresh* database already has every current table by the
time this revision runs, while an *existing* database has none of them. Every
statement here is therefore conditional on inspection rather than assumed — the
same pattern as the earlier safeguard revisions.
"""
from alembic import op
import sqlalchemy as sa


revision = "b7f2c9d41a08"
down_revision = "605d934325de"
branch_labels = None
depends_on = None


TIMESTAMP = sa.DateTime(timezone=True)


def _inspector():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return name in _inspector().get_table_names()


def _has_column(table: str, column: str) -> bool:
    if not _has_table(table):
        return False
    return column in {c["name"] for c in _inspector().get_columns(table)}


def _user_role_type():
    """Reuse the existing ``userrole`` enum rather than redefining it.

    ``users.role`` already created this type, so emitting CREATE TYPE again
    would fail on PostgreSQL.
    """
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        from sqlalchemy.dialects import postgresql

        return postgresql.ENUM(name="userrole", create_type=False)
    return sa.Enum("admin", "sender", name="userrole")


def upgrade() -> None:
    # ---------------------------------------------------------------- Phase 1
    # Platform admin is deliberately separate from the tenant `admin` role.
    if not _has_column("users", "is_platform_admin"):
        op.add_column(
            "users",
            sa.Column("is_platform_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    if not _has_table("invitations"):
        op.create_table(
            "invitations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("role", _user_role_type(), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("invited_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("expires_at", TIMESTAMP, nullable=False),
            sa.Column("accepted_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_invitations_token_hash", "invitations", ["token_hash"], unique=True)
        op.create_index("ix_invitations_organization_id", "invitations", ["organization_id"])
        op.create_index("ix_invitations_email", "invitations", ["email"])

    # OTP is now stored hashed, with attempt tracking and lockout.
    if not _has_column("recipients", "otp_code_hash"):
        op.add_column("recipients", sa.Column("otp_code_hash", sa.String(64), nullable=True))
    if not _has_column("recipients", "otp_attempts"):
        op.add_column(
            "recipients",
            sa.Column("otp_attempts", sa.Integer(), nullable=False, server_default="0"),
        )
    if not _has_column("recipients", "otp_locked_until"):
        op.add_column("recipients", sa.Column("otp_locked_until", TIMESTAMP, nullable=True))
    # Plaintext codes are not migrated: any in-flight code is short-lived and a
    # signer can simply request a new one.
    if _has_column("recipients", "otp_code"):
        op.drop_column("recipients", "otp_code")

    # Gateway secrets are encrypted at rest, and ciphertext is longer than plaintext.
    if _has_table("organizations"):
        for column in ("smtp_password", "twilio_auth_token", "telnyx_api_key"):
            if _has_column("organizations", column):
                op.alter_column(
                    "organizations",
                    column,
                    type_=sa.String(765),
                    existing_type=sa.String(255),
                    existing_nullable=True,
                )

    # ---------------------------------------------------------------- Phase 2
    if not _has_table("plans"):
        op.create_table(
            "plans",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("code", sa.String(50), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.String(500), nullable=True),
            sa.Column("price_cents", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
            sa.Column("billing_interval", sa.String(20), nullable=False, server_default="month"),
            sa.Column("trial_days", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("external_price_id", sa.String(255), nullable=True),
            sa.Column("entitlements", sa.JSON(), nullable=False),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_plans_code", "plans", ["code"], unique=True)

    if not _has_table("subscriptions"):
        op.create_table(
            "subscriptions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("plan_id", sa.String(36), sa.ForeignKey("plans.id"), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("current_period_start", TIMESTAMP, nullable=True),
            sa.Column("current_period_end", TIMESTAMP, nullable=True),
            sa.Column("trial_ends_at", TIMESTAMP, nullable=True),
            sa.Column("canceled_at", TIMESTAMP, nullable=True),
            sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("provider", sa.String(50), nullable=True),
            sa.Column("provider_customer_id", sa.String(255), nullable=True),
            sa.Column("provider_subscription_id", sa.String(255), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_subscriptions_organization_id", "subscriptions", ["organization_id"])
        op.create_index("ix_subscriptions_plan_id", "subscriptions", ["plan_id"])
        op.create_index(
            "ix_subscriptions_provider_subscription_id", "subscriptions", ["provider_subscription_id"]
        )

    if not _has_table("usage_events"):
        op.create_table(
            "usage_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id"), nullable=True),
            sa.Column("event_type", sa.String(50), nullable=False),
            sa.Column("quantity", sa.BigInteger(), nullable=False, server_default="1"),
            sa.Column("occurred_at", TIMESTAMP, nullable=False),
            sa.Column("metadata", sa.JSON(), nullable=True),
        )
        op.create_index(
            "ix_usage_events_org_type_time",
            "usage_events",
            ["organization_id", "event_type", "occurred_at"],
        )

    if not _has_table("billing_webhook_events"):
        op.create_table(
            "billing_webhook_events",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("provider", sa.String(50), nullable=False),
            sa.Column("event_id", sa.String(255), nullable=False),
            sa.Column("event_type", sa.String(100), nullable=False),
            sa.Column("received_at", TIMESTAMP, nullable=False),
            sa.Column("payload", sa.JSON(), nullable=True),
        )
        # This unique index is what makes inbound provider webhooks idempotent.
        op.create_index(
            "uq_billing_webhook_events_provider_event",
            "billing_webhook_events",
            ["provider", "event_id"],
            unique=True,
        )

    _seed_default_plans()

    # ---------------------------------------------------------------- Phase 4
    if not _has_table("webhook_endpoints"):
        op.create_table(
            "webhook_endpoints",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("url", sa.String(2048), nullable=False),
            sa.Column("secret", sa.String(128), nullable=False),
            sa.Column("event_types", sa.JSON(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("description", sa.String(255), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_webhook_endpoints_organization_id", "webhook_endpoints", ["organization_id"])

    if not _has_table("webhook_deliveries"):
        op.create_table(
            "webhook_deliveries",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("endpoint_id", sa.String(36), sa.ForeignKey("webhook_endpoints.id"), nullable=False),
            sa.Column("event_id", sa.String(36), nullable=False),
            sa.Column("event_type", sa.String(80), nullable=False),
            # Intentionally not a foreign key: a delivery record must outlive its document.
            sa.Column("document_id", sa.String(36), nullable=True),
            sa.Column("payload", sa.JSON(), nullable=True),
            sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("status_code", sa.Integer(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("delivered_at", TIMESTAMP, nullable=True),
            sa.Column("next_retry_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_webhook_deliveries_endpoint_id", "webhook_deliveries", ["endpoint_id"])
        op.create_index("ix_webhook_deliveries_status", "webhook_deliveries", ["status"])
        op.create_index("ix_webhook_deliveries_next_retry_at", "webhook_deliveries", ["next_retry_at"])


def _seed_default_plans() -> None:
    """Insert the starting plan catalogue.

    The values are inlined rather than imported from ``app.models.plan`` so this
    revision stays a frozen historical record: changing pricing later must be a
    new migration, not a silent rewrite of this one.
    """
    import json
    from uuid import uuid4

    bind = op.get_bind()
    existing = {row[0] for row in bind.execute(sa.text("SELECT code FROM plans"))}

    rows = [
        {
            "code": "free",
            "name": "Free",
            "description": "Get started with SignFlow.",
            "price_cents": 0,
            "trial_days": 0,
            "sort_order": 0,
            "entitlements": {
                "max_documents_per_month": 5,
                "max_users": 2,
                "max_storage_bytes": 100 * 1024 * 1024,
                "max_recipients_per_document": 3,
                "custom_branding": False,
                "api_access": False,
                "webhooks": False,
            },
        },
        {
            "code": "growth",
            "name": "Growth",
            "description": "For teams sending contracts every week.",
            "price_cents": 4900,
            "trial_days": 14,
            "sort_order": 1,
            "entitlements": {
                "max_documents_per_month": 250,
                "max_users": 10,
                "max_storage_bytes": 25 * 1024 * 1024 * 1024,
                "max_recipients_per_document": 10,
                "custom_branding": True,
                "api_access": True,
                "webhooks": True,
            },
        },
        {
            "code": "enterprise",
            "name": "Enterprise",
            "description": "Unlimited volume with white-glove onboarding.",
            "price_cents": 49900,
            "trial_days": 0,
            "sort_order": 2,
            # null means unlimited
            "entitlements": {
                "max_documents_per_month": None,
                "max_users": None,
                "max_storage_bytes": None,
                "max_recipients_per_document": None,
                "custom_branding": True,
                "api_access": True,
                "webhooks": True,
            },
        },
    ]

    statement = sa.text(
        "INSERT INTO plans (id, code, name, description, price_cents, currency,"
        " billing_interval, trial_days, is_active, is_public, sort_order, entitlements,"
        " created_at, updated_at)"
        " VALUES (:id, :code, :name, :description, :price_cents, 'USD',"
        " 'month', :trial_days, TRUE, TRUE, :sort_order, :entitlements,"
        " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
    )
    for row in rows:
        if row["code"] in existing:
            continue
        bind.execute(
            statement,
            {
                "id": str(uuid4()),
                "code": row["code"],
                "name": row["name"],
                "description": row["description"],
                "price_cents": row["price_cents"],
                "trial_days": row["trial_days"],
                "sort_order": row["sort_order"],
                "entitlements": json.dumps(row["entitlements"]),
            },
        )


def downgrade() -> None:
    for table in (
        "webhook_deliveries",
        "webhook_endpoints",
        "billing_webhook_events",
        "usage_events",
        "subscriptions",
        "plans",
        "invitations",
    ):
        if _has_table(table):
            op.drop_table(table)

    if _has_column("recipients", "otp_locked_until"):
        op.drop_column("recipients", "otp_locked_until")
    if _has_column("recipients", "otp_attempts"):
        op.drop_column("recipients", "otp_attempts")
    if _has_column("recipients", "otp_code_hash"):
        op.drop_column("recipients", "otp_code_hash")
    if not _has_column("recipients", "otp_code"):
        op.add_column("recipients", sa.Column("otp_code", sa.String(10), nullable=True))

    for column in ("smtp_password", "twilio_auth_token", "telnyx_api_key"):
        if _has_column("organizations", column):
            op.alter_column(
                "organizations",
                column,
                type_=sa.String(255),
                existing_type=sa.String(765),
                existing_nullable=True,
            )

    if _has_column("users", "is_platform_admin"):
        op.drop_column("users", "is_platform_admin")
