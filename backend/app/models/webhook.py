from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class WebhookEndpoint(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A customer-registered HTTPS URL that receives platform events."""

    __tablename__ = "webhook_endpoints"
    __table_args__ = (Index("ix_webhook_endpoints_organization_id", "organization_id"),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    secret: Mapped[str] = mapped_column(String(128), nullable=False)
    event_types: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    deliveries: Mapped[list["WebhookDelivery"]] = relationship(
        back_populates="endpoint", cascade="all, delete-orphan", passive_deletes=True
    )

    def subscribes_to(self, event_type: str) -> bool:
        if not self.event_types:
            return True  # empty / null == subscribe to everything
        return event_type in self.event_types or "*" in self.event_types


class WebhookDelivery(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One attempted (and retried) delivery of one event to one endpoint."""

    __tablename__ = "webhook_deliveries"
    __table_args__ = (
        Index("ix_webhook_deliveries_endpoint_id", "endpoint_id"),
        Index("ix_webhook_deliveries_status", "status"),
        Index("ix_webhook_deliveries_next_retry_at", "next_retry_at"),
    )

    endpoint_id: Mapped[str] = mapped_column(ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), nullable=False)
    event_id: Mapped[str] = mapped_column(String(36), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    document_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    endpoint: Mapped["WebhookEndpoint"] = relationship(back_populates="deliveries")
