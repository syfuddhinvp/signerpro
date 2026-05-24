from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import DocumentVersionType
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class DocumentVersion(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "document_versions"
    __table_args__ = (Index("ix_document_versions_document_id", "document_id"),)

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    version_type: Mapped[DocumentVersionType] = mapped_column(Enum(DocumentVersionType), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    document: Mapped["Document"] = relationship(back_populates="versions")

