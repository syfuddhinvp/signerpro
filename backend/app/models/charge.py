from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin, now_utc


class Charge(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One payment attempt (BIL-5) — also backs the dunning queue (REV-2)."""

    __tablename__ = "charges"
    __table_args__ = (
        Index("ix_charges_organization_id", "organization_id"),
        Index("ix_charges_status", "status"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    invoice_id: Mapped[str | None] = mapped_column(ForeignKey("invoices.id"), nullable=True)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD", server_default="USD")
    # succeeded | recovered | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="succeeded", server_default="succeeded")
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    method_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    decline_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    dunning_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
