"""contacts, contact groups, teams, folders, favourites; document + recipient library columns

Revision ID: d1f4a2b6c701
Revises: c4a1e0d73b52
Create Date: 2026-08-28

Guarded the same way as b7f2c9d41a08 / c4a1e0d73b52: `0001_initial` runs
`create_all` against live metadata, so a fresh database already has these
tables and columns by the time this revision runs.

`teams` is created here rather than in the support/logs revision because
`folders.team_id` references it.
"""
from alembic import op
import sqlalchemy as sa


revision = "d1f4a2b6c701"
down_revision = "c4a1e0d73b52"
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


def _create_index(name: str, table: str, cols: list[str], unique: bool = False) -> None:
    if name not in _indexes(table):
        op.create_index(name, table, cols, unique=unique)


def upgrade() -> None:
    if not _has_table("teams"):
        op.create_table(
            "teams",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.String(255), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_teams_organization_id", "teams", ["organization_id"])

    if not _has_table("team_members"):
        op.create_table(
            "team_members",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("role", sa.String(20), nullable=False, server_default="member"),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index("uq_team_members", "team_members", ["team_id", "user_id"], unique=True)

    if not _has_table("folders"):
        op.create_table(
            "folders",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("parent_id", sa.String(36), sa.ForeignKey("folders.id"), nullable=True),
            sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id"), nullable=True),
            sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_folders_organization_id", "folders", ["organization_id"])

    if not _has_table("contacts"):
        op.create_table(
            "contacts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("company", sa.String(255), nullable=True),
            sa.Column("title", sa.String(120), nullable=True),
            sa.Column("phone", sa.String(30), nullable=True),
            sa.Column("default_role", sa.String(20), nullable=False, server_default="sign"),
            sa.Column("group_key", sa.String(40), nullable=False, server_default="customers"),
            sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
            sa.Column("tags", sa.JSON(), nullable=True),
            sa.Column("color", sa.String(9), nullable=True),
            sa.Column("last_signed_at", TIMESTAMP, nullable=True),
            sa.Column("external_id", sa.String(255), nullable=True),
            sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("ix_contacts_organization_id", "contacts", ["organization_id"])
        op.create_index("uq_contacts_org_email", "contacts", ["organization_id", "email"], unique=True)
        op.create_index("ix_contacts_group", "contacts", ["group_key"])

    if not _has_table("contact_groups"):
        op.create_table(
            "contact_groups",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
            sa.Column("key", sa.String(40), nullable=False),
            sa.Column("label", sa.String(80), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", TIMESTAMP, nullable=False),
            sa.Column("updated_at", TIMESTAMP, nullable=False),
        )
        op.create_index("uq_contact_groups_org_key", "contact_groups", ["organization_id", "key"], unique=True)

    if not _has_table("document_favorites"):
        op.create_table(
            "document_favorites",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id"), nullable=False),
            sa.Column("created_at", TIMESTAMP, nullable=False),
        )
        op.create_index("uq_document_favorites", "document_favorites", ["user_id", "document_id"], unique=True)

    # ------------------------------------------------------------- documents
    _add_column("documents", sa.Column("owner_user_id", sa.String(36), nullable=True))
    _add_column("documents", sa.Column("folder_id", sa.String(36), nullable=True))
    _add_column("documents", sa.Column("source_template_id", sa.String(36), nullable=True))
    _add_column("documents", sa.Column("doc_type", sa.String(30), nullable=True))
    _add_column("documents", sa.Column("archived_at", TIMESTAMP, nullable=True))
    _add_column("documents", sa.Column("deleted_at", TIMESTAMP, nullable=True))
    _create_index("ix_documents_folder_id", "documents", ["folder_id"])
    _create_index("ix_documents_source_template_id", "documents", ["source_template_id"])
    _create_index("ix_documents_archived_at", "documents", ["archived_at"])
    _create_index("ix_documents_deleted_at", "documents", ["deleted_at"])
    _create_index("ix_documents_org_deleted_status", "documents", ["organization_id", "deleted_at", "status"])

    # ------------------------------------------------------------ recipients
    _add_column("recipients", sa.Column("role", sa.String(20), nullable=False, server_default="sign"))
    _add_column("recipients", sa.Column("color", sa.String(9), nullable=True))
    _add_column("recipients", sa.Column("contact_id", sa.String(36), nullable=True))
    _create_index("ix_recipients_contact_id", "recipients", ["contact_id"])


def downgrade() -> None:
    for name, table in (
        ("ix_recipients_contact_id", "recipients"),
        ("ix_documents_org_deleted_status", "documents"),
        ("ix_documents_deleted_at", "documents"),
        ("ix_documents_archived_at", "documents"),
        ("ix_documents_source_template_id", "documents"),
        ("ix_documents_folder_id", "documents"),
    ):
        if name in _indexes(table):
            op.drop_index(name, table_name=table)
    for column in ("contact_id", "color", "role"):
        if column in _columns("recipients"):
            op.drop_column("recipients", column)
    for column in ("deleted_at", "archived_at", "doc_type", "source_template_id", "folder_id", "owner_user_id"):
        if column in _columns("documents"):
            op.drop_column("documents", column)
    for table in (
        "document_favorites",
        "contact_groups",
        "contacts",
        "folders",
        "team_members",
        "teams",
    ):
        if _has_table(table):
            op.drop_table(table)
