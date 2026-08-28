"""api keys, embed sessions, feature flags, security posture, impersonation, platform audit; org identity columns

Revision ID: d4f4a2b6c704
Revises: d3f4a2b6c703
Create Date: 2026-08-28

API keys store only a SHA-256 hash of the secret plus a display prefix and the
last four characters. The full secret is returned once, by the creating route.
"""
from alembic import op
import sqlalchemy as sa


revision = "d4f4a2b6c704"
down_revision = "d3f4a2b6c703"
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
    if not _has_table("api_keys"):
        op.create_table(
            "api_keys",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("mode", sa.String(10), nullable=False, server_default="test"),
            sa.Column("prefix", sa.String(16), nullable=False),
            sa.Column("last_four", sa.String(4), nullable=False, server_default=""),
            sa.Column("key_hash", sa.String(64), nullable=False),
            sa.Column("scopes", sa.JSON(), nullable=False),
            sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("last_used_at", TIMESTAMP, nullable=True),
            sa.Column("revoked_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_api_keys_organization_id", "api_keys", ["organization_id"])
        op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)

    if not _has_table("embed_sessions"):
        op.create_table(
            "embed_sessions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id"), nullable=True),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("landing", sa.String(20), nullable=False, server_default="builder"),
            sa.Column("external_id", sa.String(255), nullable=True),
            sa.Column("return_url", sa.String(1024), nullable=True),
            sa.Column("allowed_origins", sa.JSON(), nullable=True),
            sa.Column("contact_ids", sa.JSON(), nullable=True),
            sa.Column("expires_at", TIMESTAMP, nullable=False),
            sa.Column("consumed_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_embed_sessions_token_hash", "embed_sessions", ["token_hash"], unique=True)
        op.create_index("ix_embed_sessions_organization_id", "embed_sessions", ["organization_id"])

    if not _has_table("feature_flags"):
        op.create_table(
            "feature_flags",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("key", sa.String(120), nullable=False),
            sa.Column("description", sa.String(500), nullable=True),
            sa.Column("environment", sa.String(20), nullable=False, server_default="prod"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("rollout_pct", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_feature_flags_key", "feature_flags", ["key"], unique=True)

    if not _has_table("feature_flag_overrides"):
        op.create_table(
            "feature_flag_overrides",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("flag_id", sa.String(36), sa.ForeignKey("feature_flags.id"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index(
            "uq_flag_override", "feature_flag_overrides", ["flag_id", "organization_id"], unique=True
        )

    if not _has_table("security_posture"):
        op.create_table(
            "security_posture",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("key", sa.String(40), nullable=False),
            sa.Column("label", sa.String(160), nullable=False),
            sa.Column("detail", sa.String(255), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("updated_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_security_posture_key", "security_posture", ["key"], unique=True)

    if not _has_table("certifications"):
        op.create_table(
            "certifications",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="certified"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_certifications_name", "certifications", ["name"], unique=True)

    if not _has_table("impersonation_sessions"):
        op.create_table(
            "impersonation_sessions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("admin_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("justification", sa.String(255), nullable=False),
            sa.Column("scopes", sa.JSON(), nullable=True),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("expires_at", TIMESTAMP, nullable=False),
            sa.Column("ended_at", TIMESTAMP, nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index(
            "ix_impersonation_sessions_token_hash", "impersonation_sessions", ["token_hash"], unique=True
        )
        op.create_index(
            "ix_impersonation_sessions_organization_id", "impersonation_sessions", ["organization_id"]
        )

    if not _has_table("platform_audit_entries"):
        op.create_table(
            "platform_audit_entries",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("action", sa.String(80), nullable=False),
            sa.Column("actor_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("actor_email", sa.String(320), nullable=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=True),
            sa.Column("detail", sa.String(512), nullable=True),
            sa.Column("ip_address", sa.String(80), nullable=True),
            sa.Column("metadata", sa.JSON(), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_platform_audit_entries_created_at", "platform_audit_entries", ["created_at"])
        op.create_index(
            "ix_platform_audit_entries_organization_id", "platform_audit_entries", ["organization_id"]
        )

    # ---------------------------------------------------------- organizations
    _add_column("organizations", sa.Column("slug", sa.String(80), nullable=True))
    _add_column("organizations", sa.Column("region", sa.String(40), nullable=True))
    _add_column("organizations", sa.Column("company_size", sa.String(30), nullable=True))
    _add_column("organizations", sa.Column("seats_licensed", sa.Integer(), nullable=False, server_default="0"))
    _add_column("organizations", sa.Column("accent_color", sa.String(9), nullable=True))
    _add_column("organizations", sa.Column("logo_url", sa.String(1024), nullable=True))
    _add_column("organizations", sa.Column("owner_user_id", sa.String(36), nullable=True))
    _add_column("organizations", sa.Column("suspended_at", TIMESTAMP, nullable=True))
    _add_column("organizations", sa.Column("suspension_reason", sa.String(255), nullable=True))
    _add_column("organizations", sa.Column("allowed_origins", sa.JSON(), nullable=True))
    _add_column("organizations", sa.Column("default_return_url", sa.String(1024), nullable=True))
    _add_column(
        "organizations", sa.Column("live_mode_enabled", sa.Boolean(), nullable=False, server_default=sa.true())
    )

    # Backfill slugs for existing tenants, then make them unique.
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, name FROM organizations WHERE slug IS NULL OR slug = ''")
    ).fetchall()
    used = {
        row[0]
        for row in bind.execute(
            sa.text("SELECT slug FROM organizations WHERE slug IS NOT NULL AND slug <> ''")
        ).fetchall()
    }
    for org_id, name in rows:
        base = "".join(ch if ch.isalnum() else "-" for ch in (name or "org").lower()).strip("-")[:60] or "org"
        slug = base
        suffix = 2
        while slug in used:
            slug = f"{base}-{suffix}"
            suffix += 1
        used.add(slug)
        bind.execute(
            sa.text("UPDATE organizations SET slug = :slug WHERE id = :id"), {"slug": slug, "id": org_id}
        )

    if "ix_organizations_slug" not in _indexes("organizations"):
        op.create_index("ix_organizations_slug", "organizations", ["slug"], unique=True)


def downgrade() -> None:
    if "ix_organizations_slug" in _indexes("organizations"):
        op.drop_index("ix_organizations_slug", table_name="organizations")
    for column in (
        "live_mode_enabled",
        "default_return_url",
        "allowed_origins",
        "suspension_reason",
        "suspended_at",
        "owner_user_id",
        "logo_url",
        "accent_color",
        "seats_licensed",
        "company_size",
        "region",
        "slug",
    ):
        if column in _columns("organizations"):
            op.drop_column("organizations", column)
    for table in (
        "platform_audit_entries",
        "impersonation_sessions",
        "certifications",
        "security_posture",
        "feature_flag_overrides",
        "feature_flags",
        "embed_sessions",
        "api_keys",
    ):
        if _has_table(table):
            op.drop_table(table)
