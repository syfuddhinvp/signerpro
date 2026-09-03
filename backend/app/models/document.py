from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import DocumentStatus, WorkflowType
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Document(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_organization_status", "organization_id", "status"),
        Index("ix_documents_sender_id", "sender_id"),
        Index("ix_documents_org_deleted_status", "organization_id", "deleted_at", "status"),
        Index("ix_documents_folder_id", "folder_id"),
        Index("ix_documents_source_template_id", "source_template_id"),
        Index("ix_documents_archived_at", "archived_at"),
        Index("ix_documents_deleted_at", "deleted_at"),
        # Library "owned by me" filter: document_service.list_documents filters
        # ``organization_id AND (owner_user_id = me OR sender_id = me)``.
        Index("ix_documents_org_owner", "organization_id", "owner_user_id"),
    )

    # RESTRICT on both: executed documents are legally retained records.
    # Deleting a tenant or a sender that still owns documents must raise a FK
    # violation, never silently destroy evidence (see Organization.documents).
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="RESTRICT"), nullable=False, index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[DocumentStatus] = mapped_column(Enum(DocumentStatus), nullable=False, default=DocumentStatus.draft)
    workflow_type: Mapped[WorkflowType] = mapped_column(Enum(WorkflowType), nullable=False, default=WorkflowType.parallel)
    original_file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    final_file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    original_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_template: Mapped[bool] = mapped_column(default=False, nullable=False)
    field_config_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    final_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Anchor for the audit hash chain (C6). Persisted at append time so that
    # truncating the tail of the trail is detectable, not just editing it.
    audit_chain_head: Mapped[str | None] = mapped_column(String(64), nullable=True)
    audit_entry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Library organisation (DOC-1…DOC-8, TPL-1, TPL-4)
    # Distinct from sender_id: ownership survives reassignment.
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    folder_id: Mapped[str | None] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)
    source_template_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    # agreement | nda | order | hr
    doc_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Soft delete / trash; hard purge only from trash.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Routing settings (RTE-1)
    reminder_cadence: Mapped[str] = mapped_column(String(10), nullable=False, default="48h", server_default="48h")
    expires_in_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14, server_default="14")
    invite_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invite_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="documents")
    sender: Mapped["User"] = relationship(back_populates="documents", foreign_keys=[sender_id])
    # passive_deletes: the FKs are ON DELETE CASCADE, so let Postgres remove the
    # children instead of loading every row into the session first.
    recipients: Mapped[list["Recipient"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )
    fields: Mapped[list["Field"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )
    signatures: Mapped[list["Signature"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )
    signing_tokens: Mapped[list["SigningToken"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )
    # RETENTION (C6): no delete cascade. Audit records are evidence and must
    # survive the document — ESIGN/UETA and eIDAS require the trail to be
    # retained independently of the signed artefact. Deleting a Document nulls
    # AuditLog.document_id; document_service.purge() denormalizes identity onto
    # the rows first (see audit_service.detach_document).
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="document")
    versions: Mapped[list["DocumentVersion"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )

