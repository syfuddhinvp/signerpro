from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import DocumentStatus, WorkflowType
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Document(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_organization_status", "organization_id", "status"),
        Index("ix_documents_sender_id", "sender_id"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
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
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="documents")
    sender: Mapped["User"] = relationship(back_populates="documents")
    recipients: Mapped[list["Recipient"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    fields: Mapped[list["Field"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    signatures: Mapped[list["Signature"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    signing_tokens: Mapped[list["SigningToken"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="document", cascade="all, delete-orphan")
    versions: Mapped[list["DocumentVersion"]] = relationship(back_populates="document", cascade="all, delete-orphan")

