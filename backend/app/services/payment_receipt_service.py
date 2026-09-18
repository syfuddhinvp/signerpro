"""PAY-2: the tenant's own financial record of a settled signer payment.

Why this exists at all. Before it, a settled `SignerPayment` held Stripe's
identifiers and a ``receipt_url`` pointing at a page hosted on the *tenant's
connected Stripe account*. That URL was the only human-readable evidence the
payment happened -- a document this application does not host, cannot
reproduce, and loses outright the moment the tenant hits
``DELETE /api/payments/account``. The certificate of completion nonetheless
printed "Paid", so an executed, sealed, hash-chained document asserted a
payment whose sole proof lived at a third party and could disappear without
trace.

This service closes that by issuing a `PaymentReceipt`: a numbered,
checksummed, immutable record held in this application, renderable as a PDF
on demand, cross-referenced both ways with the tamper-evident audit chain.

Three rules govern everything below.

1. **Issuing must never fail a settlement.** The money has already moved by
   the time `_reconcile` runs. A receipt that raised would roll back the
   transaction marking the payment as received, leaving a signer charged and
   an envelope still refusing their signature -- strictly worse than no
   receipt. So `issue_for_payment` is best-effort and logs loudly.
2. **Exactly one receipt per payment.** Settlement is driven by a webhook
   Stripe redelivers, so this is enforced by a unique index and handled as a
   normal outcome, not an error.
3. **Issued content is never rewritten.** Only the refund columns and the
   status they drive ever change, and a legitimate change recomputes the
   checksum. Any other divergence between row and checksum is evidence of
   tampering, which is exactly what `verify` reports.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.hashing import sha256_json
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.enums import PaymentReceiptStatus
from app.models.organization import Organization
from app.models.payment_receipt import PaymentReceipt
from app.models.recipient import Recipient
from app.models.signer_payment import SignerPayment
from app.services import pdf_layout

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _stamp(value: datetime | None) -> str | None:
    """Timezone-stable timestamp for hashing.

    Exactly `audit_service._stamp`, and for exactly the same reason: backends
    disagree on whether a ``DateTime(timezone=True)`` column round-trips as
    aware (PostgreSQL) or naive (SQLite). Without normalising, a checksum
    computed at issue time fails to reproduce the moment the row is reloaded,
    and every receipt on SQLite would report itself as tampered with.
    """
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.isoformat()


def _shown(value: datetime | None) -> str | None:
    """A timestamp as a reader sees it, not as the checksum sees it.

    Separate from `_stamp`, which is the canonical ISO form the receipt hashes
    over: rendering that form on the page would put a machine's timestamp in
    front of a person, and changing it to suit them would break every seal.
    """
    if value is None:
        return None
    return value.strftime("%d %b %Y %H:%M UTC")


def _money(cents: int, currency: str) -> str:
    return f"{cents / 100:,.2f} {currency.upper()}"


class PaymentReceiptService:
    # ------------------------------------------------------------- numbering

    def _next_number(self, db: Session, *, organization_id: str, moment: datetime) -> str:
        """``RCP-<year>-<seq>``, sequential within one organization.

        Scoped per organization, unlike `billing_service._next_invoice_number`
        which numbers platform invoices globally. A receipt is the *tenant's*
        document in their own series; a tenant whose receipt numbers jumped
        because an unrelated tenant took a payment could not reconcile them
        against their books, and in several jurisdictions a gapped series is
        itself a finding.
        """
        prefix = f"RCP-{moment.year}-"
        count = int(
            db.scalar(
                select(func.count(PaymentReceipt.id)).where(
                    PaymentReceipt.organization_id == organization_id,
                    PaymentReceipt.number.like(f"{prefix}%"),
                )
            )
            or 0
        )
        return f"{prefix}{count + 1:06d}"

    # ------------------------------------------------------------- checksum

    def canonical_content(self, receipt: PaymentReceipt) -> dict[str, Any]:
        """The receipt's hash-covered content.

        Deliberately excludes ``id``, ``created_at``/``updated_at`` and the
        FK columns that go NULL on purge: a receipt must still verify after
        the document it documents has been erased. ``document_ref`` and the
        payer snapshot carry that identity instead.
        """
        return {
            "number": receipt.number,
            "organization_id": receipt.organization_id,
            "signer_payment_id": receipt.signer_payment_id,
            "document_ref": receipt.document_ref,
            "document_title": receipt.document_title,
            "payer_name": receipt.payer_name,
            "payer_email": receipt.payer_email,
            "issuer_name": receipt.issuer_name,
            "description": receipt.description,
            "currency": receipt.currency,
            "subtotal_cents": receipt.subtotal_cents,
            "tax_cents": receipt.tax_cents,
            "total_cents": receipt.total_cents,
            "refunded_amount_cents": receipt.refunded_amount_cents,
            # `str()` because the attribute is the `StrEnum` before a flush
            # and the same `StrEnum` after a reload, but a raw enum repr would
            # differ between the two on some SQLAlchemy versions.
            "status": str(receipt.status),
            "line_items": receipt.line_items,
            "provider": receipt.provider,
            "provider_account_id": receipt.provider_account_id,
            "provider_payment_intent_id": receipt.provider_payment_intent_id,
            "provider_charge_id": receipt.provider_charge_id,
            "issued_at": _stamp(receipt.issued_at),
            "paid_at": _stamp(receipt.paid_at),
            "refunded_at": _stamp(receipt.refunded_at),
        }

    def _reseal(self, receipt: PaymentReceipt) -> None:
        receipt.checksum = sha256_json(self.canonical_content(receipt))

    def verify(self, receipt: PaymentReceipt) -> bool:
        """``True`` when the stored row still matches its checksum.

        A receipt issued before ``checksum`` was populated verifies as
        ``False`` rather than ``True``: "unverifiable" must never render as
        "verified".
        """
        if not receipt.checksum:
            return False
        return receipt.checksum == sha256_json(self.canonical_content(receipt))

    # --------------------------------------------------------------- issuing

    def get_for_payment(self, db: Session, *, signer_payment_id: str) -> PaymentReceipt | None:
        return db.scalar(
            select(PaymentReceipt).where(PaymentReceipt.signer_payment_id == signer_payment_id)
        )

    def issue_for_payment(
        self,
        db: Session,
        *,
        payment: SignerPayment,
        document: Document | None = None,
        audit_log_id: str | None = None,
    ) -> PaymentReceipt | None:
        """Issue the receipt for a just-settled payment, or return the existing one.

        Best-effort by contract -- see rule 1 in the module docstring. The
        row is added and flushed but **not committed**: it joins the same
        transaction that marks the payment as succeeded, so a settlement and
        its receipt are one atomic fact rather than two that can disagree.
        """
        existing = self.get_for_payment(db, signer_payment_id=payment.id)
        if existing is not None:
            return existing

        try:
            if document is None:
                document = db.get(Document, payment.document_id)
            recipient = db.get(Recipient, payment.recipient_id)
            organization = db.get(Organization, payment.organization_id)
            now = _utcnow()
            amount = int(payment.amount_cents)
            description = payment.description or (
                f"Payment on {document.title}" if document is not None else "Signer payment"
            )

            # Numbering races are retried inside a SAVEPOINT so a collision
            # cannot poison the outer transaction that is settling the money.
            for _ in range(5):
                receipt = PaymentReceipt(
                    organization_id=payment.organization_id,
                    signer_payment_id=payment.id,
                    document_id=payment.document_id,
                    document_ref=payment.document_id,
                    recipient_id=payment.recipient_id,
                    number=self._next_number(
                        db, organization_id=payment.organization_id, moment=now
                    ),
                    status=PaymentReceiptStatus.issued,
                    currency=payment.currency,
                    subtotal_cents=amount,
                    tax_cents=0,
                    total_cents=amount,
                    refunded_amount_cents=int(payment.refunded_amount_cents or 0),
                    payer_name=recipient.name if recipient else None,
                    payer_email=recipient.email if recipient else None,
                    document_title=document.title if document is not None else None,
                    issuer_name=organization.name if organization else None,
                    description=description,
                    line_items=[
                        {
                            "description": description,
                            "quantity": 1,
                            "unit_cents": amount,
                            "amount_cents": amount,
                        }
                    ],
                    provider=payment.provider or "stripe",
                    provider_account_id=payment.provider_account_id,
                    provider_payment_intent_id=payment.provider_payment_intent_id,
                    provider_charge_id=payment.provider_charge_id,
                    provider_receipt_url=payment.receipt_url,
                    issued_at=now,
                    paid_at=payment.paid_at or now,
                    audit_log_id=audit_log_id,
                )
                self._reseal(receipt)
                try:
                    with db.begin_nested():
                        db.add(receipt)
                        db.flush()
                except IntegrityError:
                    # Either a numbering race, or a redelivered webhook that
                    # already issued this payment's receipt. The second is
                    # the expected case and is not an error.
                    settled = self.get_for_payment(db, signer_payment_id=payment.id)
                    if settled is not None:
                        return settled
                    continue
                return receipt

            logger.error(
                "payment_receipt.number_allocation_failed",
                extra={"signer_payment_id": payment.id, "organization_id": payment.organization_id},
            )
            return None
        except Exception:  # noqa: BLE001 - rule 1: never fail a settlement
            logger.exception(
                "payment_receipt.issue_failed", extra={"signer_payment_id": payment.id}
            )
            return None

    # --------------------------------------------------------------- refunds

    def apply_refund(
        self, db: Session, *, payment: SignerPayment, receipt: PaymentReceipt | None = None
    ) -> PaymentReceipt | None:
        """Bring a receipt's refund state in line with its payment.

        Reads the refunded total off `SignerPayment` rather than adding a
        delta, so a redelivered or retried refund cannot double-count. The
        checksum is recomputed, because this is the one mutation a receipt is
        allowed to undergo.
        """
        if receipt is None:
            receipt = self.get_for_payment(db, signer_payment_id=payment.id)
        if receipt is None:
            return None
        try:
            refunded = int(payment.refunded_amount_cents or 0)
            receipt.refunded_amount_cents = refunded
            receipt.refunded_at = payment.refunded_at
            if refunded <= 0:
                receipt.status = PaymentReceiptStatus.issued
            elif refunded >= receipt.total_cents:
                receipt.status = PaymentReceiptStatus.refunded
            else:
                receipt.status = PaymentReceiptStatus.partially_refunded
            self._reseal(receipt)
            db.add(receipt)
            return receipt
        except Exception:  # noqa: BLE001 - a refund must not fail on bookkeeping
            logger.exception("payment_receipt.refund_sync_failed", extra={"receipt_id": receipt.id})
            return receipt

    # ------------------------------------------------------------------- pdf

    def render_pdf(self, db: Session, *, receipt: PaymentReceipt) -> bytes:
        """A standalone PDF receipt in the product's house style.

        Rendered on demand from the row rather than stored as a file: the row
        is the record, the PDF is a view of it, and a stored file would be a
        second copy to keep in sync with the refund state.
        """
        sheet = pdf_layout.Sheet(
            footer=f"{receipt.number} · issued by {receipt.issuer_name or 'the issuer'}"
        )
        issued = _shown(receipt.issued_at)

        sheet.header(
            # The issuer's name sits above the title rather than under it: this
            # is their receipt, not the platform's, and the name at the top is
            # what tells a reader whose it is.
            eyebrow=receipt.issuer_name or "Receipt",
            title="Payment receipt",
            reference=receipt.number,
            issued=f"Issued {issued}" if issued else None,
        )

        # The status band is the first thing a reader should see: a fully
        # refunded receipt that looks like a paid one is the failure mode this
        # whole layout exists to prevent.
        if receipt.status == PaymentReceiptStatus.refunded:
            sheet.badge("REFUNDED IN FULL", pdf_layout.NEGATIVE)
        elif receipt.status == PaymentReceiptStatus.partially_refunded:
            returned = _money(receipt.refunded_amount_cents, receipt.currency)
            sheet.badge(f"PARTIALLY REFUNDED · {returned} RETURNED", pdf_layout.WARNING)
        else:
            sheet.badge("PAID", pdf_layout.POSITIVE)

        payer = receipt.payer_name or "Unknown payer"
        if receipt.payer_email:
            payer = f"{payer} ({receipt.payer_email})"

        sheet.section("Payment")
        sheet.rows(
            [
                ("Paid by", payer),
                ("For", receipt.description),
                ("Document", receipt.document_title),
                ("Document reference", receipt.document_ref),
                ("Date paid", _shown(receipt.paid_at)),
                ("Date refunded", _shown(receipt.refunded_at)),
            ]
        )

        sheet.section("Amount")
        totals: list[tuple[str, str, bool]] = [
            ("Subtotal", _money(receipt.subtotal_cents, receipt.currency), False),
            ("Tax", _money(receipt.tax_cents, receipt.currency), False),
            ("Total paid", _money(receipt.total_cents, receipt.currency), True),
        ]
        if receipt.refunded_amount_cents:
            totals.append(
                ("Refunded", "-" + _money(receipt.refunded_amount_cents, receipt.currency), False)
            )
            totals.append(("Net retained", _money(receipt.net_cents, receipt.currency), True))
        sheet.totals(totals)

        sheet.section("Provider references")
        sheet.rows(
            [
                ("Processor", (receipt.provider or "stripe").title()),
                ("Payment intent", receipt.provider_payment_intent_id),
                ("Charge", receipt.provider_charge_id),
                ("Connected account", receipt.provider_account_id),
            ]
        )

        sheet.space(8)
        sheet.rule()
        sheet.space(16)
        sheet.fine_print(
            [
                f"Receipt checksum (SHA-256): {receipt.checksum or 'not sealed'}",
                # Says plainly who the merchant of record is. A signer reading
                # this months later needs to know who to approach for a refund,
                # and it is not the platform.
                f"Funds were received directly by {receipt.issuer_name or 'the issuer'}, "
                "who is the merchant of record for this payment.",
                f"Linked audit trail entry: {receipt.audit_log_id}" if receipt.audit_log_id else "",
            ]
        )
        return sheet.save()

    # ------------------------------------------------------------ chain link

    def audit_entry_for(self, db: Session, *, receipt: PaymentReceipt) -> AuditLog | None:
        """The chained settlement entry this receipt documents, if still present."""
        if not receipt.audit_log_id:
            return None
        return db.get(AuditLog, receipt.audit_log_id)


payment_receipt_service = PaymentReceiptService()
