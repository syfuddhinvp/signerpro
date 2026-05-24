from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class AuditLog(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_document_id", "document_id"),
        Index("ix_audit_logs_recipient_id", "recipient_id"),
        Index("ix_audit_logs_user_id", "user_id"),
    )

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    recipient_id: Mapped[str | None] = mapped_column(ForeignKey("recipients.id"), nullable=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    event_message: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    log_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    document: Mapped["Document"] = relationship(back_populates="audit_logs")
    recipient: Mapped["Recipient"] = relationship(back_populates="audit_logs")
    user: Mapped["User"] = relationship(back_populates="audit_logs")

