from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.core.database import SessionLocal
from app.core.logging import configure_logging, get_logger, new_request_id, request_context
from app.models.audit_log import AuditLog
from app.models.enums import SignerPaymentStatus
from app.models.payment_receipt import PaymentReceipt
from app.models.signer_payment import SignerPayment
from app.services.audit_service import audit_service
from app.services.payment_receipt_service import payment_receipt_service

logger = get_logger("scripts.backfill_payment_receipts")


def backfill(
    db, *, dry_run: bool = False, organization_id: str | None = None
) -> dict[str, int]:
    """The backfill itself, against an open session. See `main` for the why.

    Separated from `main` so it can be exercised by a test rather than only
    by being run against a live database -- this writes financial and legal
    records, which is the last thing that should be verified by hand.
    """
    issued = logged = skipped = failed = 0
    query = db.query(SignerPayment).filter(
        SignerPayment.status.in_((SignerPaymentStatus.succeeded, SignerPaymentStatus.refunded))
    )
    if organization_id:
        query = query.filter(SignerPayment.organization_id == organization_id)

    for payment in query.order_by(SignerPayment.created_at.asc()).all():
        has_receipt = (
            db.query(PaymentReceipt)
            .filter(PaymentReceipt.signer_payment_id == payment.id)
            .first()
            is not None
        )
        has_entry = (
            db.query(AuditLog)
            .filter(
                AuditLog.event_type == "signer_payment_succeeded",
                AuditLog.log_metadata["payment_id"].as_string() == payment.id,
            )
            .first()
            is not None
        )
        if has_receipt and has_entry:
            skipped += 1
            continue

        if dry_run:
            logger.info(
                "backfill.would_issue",
                extra={
                    "payment_id": payment.id,
                    "organization_id": payment.organization_id,
                    "amount_cents": payment.amount_cents,
                    "currency": payment.currency,
                    "needs_receipt": not has_receipt,
                    "needs_audit_entry": not has_entry,
                },
            )
            issued += 0 if has_receipt else 1
            logged += 0 if has_entry else 1
            continue

        try:
            entry = None
            if not has_entry:
                entry = audit_service.log(
                    db,
                    document_id=payment.document_id,
                    recipient_id=payment.recipient_id,
                    event_type="signer_payment_succeeded",
                    event_message=(
                        f"Payment of {payment.amount_cents / 100:,.2f} "
                        f"{(payment.currency or 'USD').upper()} received "
                        "(record reconstructed by backfill)."
                    ),
                    # Never captured at the time. Recorded as absent rather
                    # than invented -- see `main`'s docstring.
                    ip_address=None,
                    user_agent=None,
                    metadata={
                        "payment_id": payment.id,
                        "amount_cents": payment.amount_cents,
                        "currency": payment.currency,
                        "field_id": payment.field_id,
                        "stripe_payment_intent_id": payment.provider_payment_intent_id,
                        "stripe_charge_id": payment.provider_charge_id,
                        "stripe_connected_account_id": payment.provider_account_id,
                        "merchant_of_record": "tenant_connected_account",
                        "settled_via": "unknown_pre_pay2",
                        # The load-bearing flag: this entry was NOT written
                        # when the money moved.
                        "backfilled": True,
                        "paid_at": payment.paid_at.isoformat() if payment.paid_at else None,
                    },
                )
                db.flush()
                logged += 1

            if not has_receipt:
                receipt = payment_receipt_service.issue_for_payment(
                    db, payment=payment, audit_log_id=entry.id if entry is not None else None
                )
                if receipt is None:
                    failed += 1
                    db.rollback()
                    continue
                # A payment already partly or fully refunded must not be
                # backfilled as a clean "PAID" receipt.
                if payment.refunded_amount_cents:
                    payment_receipt_service.apply_refund(db, payment=payment, receipt=receipt)
                issued += 1

            db.commit()
        except Exception:
            db.rollback()
            failed += 1
            logger.exception("backfill.payment_failed", extra={"payment_id": payment.id})

    summary = {
        "receipts_issued": issued,
        "audit_entries_written": logged,
        "already_complete": skipped,
        "failed": failed,
    }
    logger.info("backfill.complete", extra={**summary, "dry_run": dry_run})
    return summary


def main() -> None:
    """One-off recovery: records for signer payments that settled before PAY-2.

    Every payment a signer made before this existed settled silently. It wrote
    mutable columns on ``signer_payments`` and nothing else: no entry in the
    tamper-evident audit chain, and no receipt of the tenant's own. The only
    human-readable evidence was Stripe's ``receipt_url``, hosted on the
    tenant's connected account -- and the certificate of completion printed
    "Paid" regardless. This reads those settled rows back and issues the two
    records that should have been written at the time.

    Two honesty constraints govern the backfilled records, because a
    reconstructed record that cannot be told apart from a contemporaneous one
    is worse than none:

    * the audit entry carries ``backfilled: True`` and the timestamp is the
      moment of *backfill*, not of payment (``paid_at`` is in the metadata);
    * IP and user-agent are recorded as unavailable, because they are. They
      were never captured, and inventing them would be fabricating evidence.

    Idempotent -- matched on the unique ``signer_payments.id`` -> receipt
    relation and on the existing settlement entry -- so it can be re-run
    safely and used to reconcile:

        python scripts/backfill_payment_receipts.py --dry-run
        python scripts/backfill_payment_receipts.py
    """
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be issued without writing anything.",
    )
    parser.add_argument(
        "--organization-id",
        default=None,
        help="Limit to one tenant. Omit to process every organization.",
    )
    args = parser.parse_args()

    configure_logging()
    db = SessionLocal()
    try:
        with request_context(request_id=new_request_id()):
            backfill(db, dry_run=args.dry_run, organization_id=args.organization_id)
    finally:
        db.close()


if __name__ == "__main__":
    main()
