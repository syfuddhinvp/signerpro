from sqlalchemy import Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import PaymentSplitMode
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PaymentRequest(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """The envelope-level money ask (PAY-1): "collect $X across these signers".

    ``total_cents`` is not derivable from the payment fields alone -- it is
    the number the sender agreed to collect -- so it is stored so the sum of
    the per-recipient field allocations can be validated against it, and so
    partial collection (some recipients paid, some have not) is reportable
    without re-summing every `SignerPayment` row. There is no separate
    "allocation" table: an allocation is just a payment `Field` whose
    `options.payment_request_id` points here, carrying its own recipient and
    amount. A single-payer request is nothing special -- it is simply
    ``split_mode=single`` with exactly one allocation.
    """

    __tablename__ = "payment_requests"
    __table_args__ = (
        Index("ix_payment_requests_document_id", "document_id"),
        Index("ix_payment_requests_organization_id", "organization_id"),
    )

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD", server_default="USD")
    memo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    split_mode: Mapped[PaymentSplitMode] = mapped_column(
        Enum(PaymentSplitMode), nullable=False, default=PaymentSplitMode.single, server_default=PaymentSplitMode.single
    )
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
