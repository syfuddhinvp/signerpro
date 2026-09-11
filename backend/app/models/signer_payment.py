from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import SignerPaymentStatus
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class SignerPayment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One payment attempt by one recipient during signing (PAY-1).

    This is deliberately NOT the existing `Charge` model. `Charge` is
    org-to-platform subscription billing (BIL-5) -- what a tenant owes this
    application. Overloading it with signer-to-tenant money would corrupt
    revenue reporting: this money never touches the platform's balance, it
    moves from a signer to the tenant's own connected Stripe account, and the
    two cash flows must never be summed together.
    """

    __tablename__ = "signer_payments"
    __table_args__ = (
        Index("ix_signer_payments_organization_id", "organization_id"),
        Index("ix_signer_payments_document_id", "document_id"),
        Index("ix_signer_payments_recipient_id", "recipient_id"),
        Index("ix_signer_payments_field_id", "field_id"),
        Index("ix_signer_payments_payment_request_id", "payment_request_id"),
        Index("ix_signer_payments_status", "status"),
        Index("uq_signer_payments_provider_payment_intent_id", "provider_payment_intent_id", unique=True),
        Index("uq_signer_payments_idempotency_key", "idempotency_key", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False)
    field_id: Mapped[str] = mapped_column(ForeignKey("fields.id", ondelete="CASCADE"), nullable=False)
    payment_request_id: Mapped[str | None] = mapped_column(
        ForeignKey("payment_requests.id", ondelete="SET NULL"), nullable=True
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD", server_default="USD")
    status: Mapped[SignerPaymentStatus] = mapped_column(
        Enum(SignerPaymentStatus),
        nullable=False,
        default=SignerPaymentStatus.requires_payment,
        server_default=SignerPaymentStatus.requires_payment,
    )
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # The webhook looks a row up by this id, hence the unique index above.
    provider_payment_intent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_account_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_charge_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    receipt_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    failure_message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_amount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
