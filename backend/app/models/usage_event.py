from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class UsageEventType(StrEnum):
    document_created = "document_created"
    document_sent = "document_sent"
    recipient_signed = "recipient_signed"
    storage_bytes_added = "storage_bytes_added"
    api_call = "api_call"
    sms_sent = "sms_sent"


class UsageEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "usage_events"
    __table_args__ = (
        Index("ix_usage_events_org_type_time", "organization_id", "event_type", "occurred_at"),
        # Highest-volume table in the schema; a document purge does an
        # ON DELETE SET NULL across all of it.
        Index("ix_usage_events_document_id", "document_id"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    quantity: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    event_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
