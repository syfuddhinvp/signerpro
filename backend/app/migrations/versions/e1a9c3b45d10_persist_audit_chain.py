"""persist the audit hash chain and retain audit rows past document purge

Revision ID: e1a9c3b45d10
Revises: d7f4a2b6c707
Create Date: 2026-08-28

Audit finding C6. Three changes:

1. ``audit_logs`` gains ``sequence``/``checksum``/``previous_checksum`` so the
   chain is persisted at append time instead of being re-derived on read from
   the same mutable rows it is supposed to protect.
2. ``documents`` gains ``audit_chain_head``/``audit_entry_count`` as an anchor,
   which is what makes truncating the tail of a trail detectable.
3. ``audit_logs.document_id`` becomes a nullable ``ON DELETE SET NULL`` FK and
   the document's identity is denormalized onto the row (``document_ref``,
   ``document_title``, ``organization_id``) so the evidentiary record survives
   a document purge, as ESIGN/UETA and eIDAS require.
"""
from alembic import op
import sqlalchemy as sa


revision = "e1a9c3b45d10"
down_revision = "d7f4a2b6c707"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _indexes(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table)}


def upgrade() -> None:
    audit_columns = _columns("audit_logs")
    if not audit_columns:
        return

    with op.batch_alter_table("audit_logs") as batch:
        if "document_ref" not in audit_columns:
            batch.add_column(sa.Column("document_ref", sa.String(36), nullable=True))
        if "document_title" not in audit_columns:
            batch.add_column(sa.Column("document_title", sa.String(255), nullable=True))
        if "organization_id" not in audit_columns:
            batch.add_column(sa.Column("organization_id", sa.String(36), nullable=True))
        if "recipient_ref" not in audit_columns:
            batch.add_column(sa.Column("recipient_ref", sa.String(36), nullable=True))
        if "user_ref" not in audit_columns:
            batch.add_column(sa.Column("user_ref", sa.String(36), nullable=True))
        if "sequence" not in audit_columns:
            batch.add_column(sa.Column("sequence", sa.Integer(), nullable=True))
        if "checksum" not in audit_columns:
            batch.add_column(sa.Column("checksum", sa.String(64), nullable=True))
        if "previous_checksum" not in audit_columns:
            batch.add_column(sa.Column("previous_checksum", sa.String(64), nullable=True))
        # Retention: the FK must not keep an audit row hostage to its document.
        batch.alter_column("document_id", existing_type=sa.String(36), nullable=True)

    if "ix_audit_logs_document_ref" not in _indexes("audit_logs"):
        op.create_index("ix_audit_logs_document_ref", "audit_logs", ["document_ref"])

    document_columns = _columns("documents")
    if document_columns:
        with op.batch_alter_table("documents") as batch:
            if "audit_chain_head" not in document_columns:
                batch.add_column(sa.Column("audit_chain_head", sa.String(64), nullable=True))
            if "audit_entry_count" not in document_columns:
                batch.add_column(
                    sa.Column("audit_entry_count", sa.Integer(), nullable=False, server_default="0")
                )

    _backfill()


def _backfill() -> None:
    """Chain every pre-existing row so historic trails verify."""

    from app.services.audit_service import CHAIN_GENESIS, audit_service

    bind = op.get_bind()
    if "audit_logs" not in sa.inspect(bind).get_table_names():
        return

    bind.execute(
        sa.text("UPDATE audit_logs SET document_ref = document_id WHERE document_ref IS NULL")
    )
    bind.execute(
        sa.text("UPDATE audit_logs SET recipient_ref = recipient_id WHERE recipient_ref IS NULL")
    )
    bind.execute(sa.text("UPDATE audit_logs SET user_ref = user_id WHERE user_ref IS NULL"))
    if "documents" in sa.inspect(bind).get_table_names():
        bind.execute(
            sa.text(
                "UPDATE audit_logs SET document_title = ("
                " SELECT title FROM documents WHERE documents.id = audit_logs.document_ref"
                "), organization_id = ("
                " SELECT organization_id FROM documents WHERE documents.id = audit_logs.document_ref"
                ") WHERE document_title IS NULL"
            )
        )

    rows = bind.execute(
        sa.text(
            "SELECT id, document_ref, recipient_ref, user_ref, event_type, event_message,"
            " ip_address, user_agent, metadata, created_at FROM audit_logs"
            " ORDER BY document_ref, created_at, id"
        )
    ).mappings().all()

    import json
    from types import SimpleNamespace

    previous = CHAIN_GENESIS
    sequence = 0
    current_document = object()
    for row in rows:
        if row["document_ref"] != current_document:
            current_document = row["document_ref"]
            previous = CHAIN_GENESIS
            sequence = 0
        metadata = row["metadata"]
        if isinstance(metadata, (str, bytes)):
            try:
                metadata = json.loads(metadata)
            except Exception:
                metadata = None
        created_at = row["created_at"]
        if isinstance(created_at, str):
            created_at = sa.DateTime().python_type.fromisoformat(created_at)
        entry = SimpleNamespace(
            id=row["id"],
            sequence=sequence,
            document_ref=row["document_ref"],
            recipient_ref=row["recipient_ref"],
            user_ref=row["user_ref"],
            event_type=row["event_type"],
            event_message=row["event_message"],
            ip_address=row["ip_address"],
            user_agent=row["user_agent"],
            log_metadata=metadata,
            created_at=created_at,
        )
        checksum = audit_service.compute_checksum(entry, previous)
        bind.execute(
            sa.text(
                "UPDATE audit_logs SET sequence = :sequence, checksum = :checksum,"
                " previous_checksum = :previous WHERE id = :id"
            ),
            {"sequence": sequence, "checksum": checksum, "previous": previous, "id": row["id"]},
        )
        previous = checksum
        sequence += 1
        if "documents" in sa.inspect(bind).get_table_names():
            bind.execute(
                sa.text(
                    "UPDATE documents SET audit_chain_head = :head, audit_entry_count = :count"
                    " WHERE id = :id"
                ),
                {"head": previous, "count": sequence, "id": row["document_ref"]},
            )


def downgrade() -> None:
    if "ix_audit_logs_document_ref" in _indexes("audit_logs"):
        op.drop_index("ix_audit_logs_document_ref", table_name="audit_logs")
    with op.batch_alter_table("audit_logs") as batch:
        for column in ("previous_checksum", "checksum", "sequence", "user_ref", "recipient_ref", "organization_id", "document_title", "document_ref"):
            batch.drop_column(column)
    with op.batch_alter_table("documents") as batch:
        batch.drop_column("audit_entry_count")
        batch.drop_column("audit_chain_head")
