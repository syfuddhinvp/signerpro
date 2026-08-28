from sqlalchemy import Boolean, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PaymentMethod(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A stored payment instrument (BIL-2, BIL-3).

    No PAN, CVC or full bank account number is ever persisted — the provider
    token plus display metadata only.
    """

    __tablename__ = "payment_methods"
    __table_args__ = (Index("ix_payment_methods_organization_id", "organization_id"),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    # card | ach | sepa | invoice
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="card", server_default="card")
    brand: Mapped[str | None] = mapped_column(String(30), nullable=True)
    last4: Mapped[str | None] = mapped_column(String(4), nullable=True)
    exp_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exp_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    holder_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    country: Mapped[str | None] = mapped_column(String(2), nullable=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    meta: Mapped[str | None] = mapped_column(String(255), nullable=True)
    po_number: Mapped[str | None] = mapped_column(String(60), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    provider_payment_method_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
