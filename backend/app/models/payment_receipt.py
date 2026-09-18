from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.enums import PaymentReceiptStatus
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PaymentReceipt(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """The tenant's own financial record of one settled signer payment (PAY-2).

    This exists because a settled `SignerPayment` was, on its own, not a
    record anybody could produce in a dispute. It carried Stripe's ids and a
    ``receipt_url`` on the *tenant's connected account* -- a page this
    application does not host, cannot reproduce, and loses outright the
    moment the tenant disconnects Stripe. The certificate of completion
    nonetheless printed "Paid", so the executed document asserted a payment
    whose only evidence lived at a third party.

    Deliberately NOT the `Invoice` model. `Invoice` is org-to-platform
    subscription billing -- what a tenant owes *this application*. A receipt
    is signer-to-tenant money that never touches the platform's balance, and
    summing the two would corrupt revenue reporting in both directions (the
    same reasoning that keeps `SignerPayment` separate from `Charge`).

    A receipt is **immutable** apart from its refund columns and the status
    they drive: once issued, the amount, payer and provider references are
    the historical fact of the payment and are never rewritten. Everything
    the document asserts is covered by ``checksum``, so a receipt that has
    been edited in the database can be detected rather than merely trusted.

    Payer and document identity are *snapshots*, not joins. A recipient row
    can be reassigned, renamed or purged by a GDPR erasure long after the
    money moved; a receipt that resolved its payer by FK at render time would
    quietly start naming the wrong person, or nobody.
    """

    __tablename__ = "payment_receipts"
    __table_args__ = (
        Index("ix_payment_receipts_organization_id", "organization_id"),
        Index("ix_payment_receipts_document_id", "document_id"),
        Index("ix_payment_receipts_recipient_id", "recipient_id"),
        Index("ix_payment_receipts_status", "status"),
        Index("ix_payment_receipts_issued_at", "issued_at"),
        # One receipt per settled payment: the settlement path is driven by a
        # webhook Stripe redelivers, so without this a redelivery that raced
        # the first would issue a second receipt for the same money.
        Index("uq_payment_receipts_signer_payment_id", "signer_payment_id", unique=True),
        # Numbering is the tenant's own series, so it is unique per
        # organization rather than globally.
        Index("uq_payment_receipts_org_number", "organization_id", "number", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    signer_payment_id: Mapped[str] = mapped_column(
        ForeignKey("signer_payments.id", ondelete="CASCADE"), nullable=False
    )
    #: Nulled if the document is purged; ``document_ref`` keeps the id as the
    #: immutable string the receipt was issued against, exactly as the audit
    #: chain does.
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    document_ref: Mapped[str | None] = mapped_column(String(36), nullable=True)
    recipient_id: Mapped[str | None] = mapped_column(
        ForeignKey("recipients.id", ondelete="SET NULL"), nullable=True
    )

    #: Human-facing number, ``RCP-<year>-<seq>`` within one organization.
    number: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[PaymentReceiptStatus] = mapped_column(
        Enum(PaymentReceiptStatus),
        nullable=False,
        default=PaymentReceiptStatus.issued,
        server_default=PaymentReceiptStatus.issued,
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD", server_default="USD")
    subtotal_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    #: Always 0 today. The column exists because a receipt with no place to
    #: put tax is a receipt that has to be reissued to become compliant in
    #: any jurisdiction that requires the split, and reissuing an immutable
    #: financial document is exactly what must be avoided.
    tax_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    refunded_amount_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    #: Snapshots -- see the class docstring on why these are not joins.
    payer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payer_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    document_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    issuer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    #: [{description, quantity, unit_cents, amount_cents}] -- JSON for the
    #: same reason `Invoice.line_items` is: immutable once issued, never
    #: queried independently of the parent.
    line_items: Mapped[list | None] = mapped_column(JSON, nullable=True)

    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    provider_account_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_payment_intent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_charge_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Stripe's own hosted receipt, kept as a convenience cross-reference.
    #: It is no longer the *only* evidence, which was the whole defect.
    provider_receipt_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    #: SHA-256 over the canonical issued content. Recomputed only when the
    #: refund columns legitimately change, so any *other* divergence between
    #: the stored checksum and the row is evidence of tampering.
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: The `AuditLog.id` of the settlement event this receipt documents, so
    #: the receipt and the tamper-evident chain point at each other.
    audit_log_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    @property
    def net_cents(self) -> int:
        """What the tenant actually kept, after refunds."""
        return max(0, self.total_cents - self.refunded_amount_cents)
