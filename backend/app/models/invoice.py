from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin, now_utc


class InvoiceStatus(StrEnum):
    draft = "draft"
    open = "open"
    paid = "paid"
    past_due = "past_due"
    void = "void"
    uncollectible = "uncollectible"


class Invoice(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A billing document for one organization and one billing period.

    Line items are stored as JSON rather than a child table: an invoice is
    immutable once issued, so the rows are never queried or updated
    independently of their parent.
    """

    __tablename__ = "invoices"
    __table_args__ = (
        Index("ix_invoices_organization_id", "organization_id"),
        Index("ix_invoices_status", "status"),
        Index("ix_invoices_number", "number", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=InvoiceStatus.open)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")

    subtotal_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tax_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amount_paid_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # [{description, quantity, unit_cents, amount_cents}]
    line_items: Mapped[list | None] = mapped_column(JSON, nullable=True)

    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    provider_invoice_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hosted_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    # BIL-9
    provider_payment_intent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payment_method_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    period_label: Mapped[str | None] = mapped_column(String(30), nullable=True)

    @property
    def amount_due_cents(self) -> int:
        return max(0, self.total_cents - self.amount_paid_cents)

    @property
    def is_overdue(self) -> bool:
        if self.status != InvoiceStatus.open or self.due_at is None:
            return False
        due = self.due_at if self.due_at.tzinfo else self.due_at.replace(tzinfo=now_utc().tzinfo)
        return due < now_utc()
