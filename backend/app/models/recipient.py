from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import RecipientStatus
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Recipient(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "recipients"
    __table_args__ = (
        Index("ix_recipients_document_id", "document_id"),
        Index("ix_recipients_email", "email"),
        Index("ix_recipients_status", "status"),
    )

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    signing_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[RecipientStatus] = mapped_column(Enum(RecipientStatus), nullable=False, default=RecipientStatus.waiting)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    declined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decline_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    phone_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    otp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    otp_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    otp_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    consent_accepted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    consent_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    document: Mapped["Document"] = relationship(back_populates="recipients")
    fields: Mapped[list["Field"]] = relationship(back_populates="recipient", cascade="all, delete-orphan")
    signatures: Mapped[list["Signature"]] = relationship(back_populates="recipient", cascade="all, delete-orphan")
    signing_tokens: Mapped[list["SigningToken"]] = relationship(back_populates="recipient", cascade="all, delete-orphan")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="recipient")

