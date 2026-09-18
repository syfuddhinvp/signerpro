"""HTTP surface for PAY-1: signers pay the tenant's own connected Stripe account.

Three audiences share this file:

* the tenant's own sender/admin, managing their Stripe Connect account and the
  payment requests/collections on their documents (org-scoped, exactly like
  every other authenticated route in this app);
* Stripe itself, delivering `account.updated` / `payment_intent.*` webhooks
  for the connected accounts (unauthenticated, signature-verified);
* the signer-token endpoints, which live in ``signing.py`` alongside the rest
  of the token-authenticated signing surface.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.config import get_settings
from app.core.database import get_db
from app.models.document import Document
from app.models.enums import SignerPaymentStatus
from app.models.payment_receipt import PaymentReceipt
from app.models.recipient import Recipient
from app.models.subscription import ProcessedWebhookEvent
from app.models.payment_account import PaymentAccount
from app.models.signer_payment import SignerPayment
from app.models.user import User
from app.schemas.payment import (
    PaymentAccountLinkResponse,
    PaymentAccountResponse,
    PaymentLedgerEntry,
    PaymentLedgerPage,
    PaymentReceiptResponse,
    PaymentRequestCreate,
    PaymentRequestResponse,
    SignerPaymentResponse,
)
from app.services.document_service import document_service
from app.services.payment_receipt_service import payment_receipt_service
from app.services.signer_payment_service import signer_payment_service
from app.services.stripe_connect_service import stripe_connect_service

router = APIRouter(prefix="/api/payments", tags=["payments"])
document_payments_router = APIRouter(prefix="/api/documents", tags=["payments"])
connect_webhook_router = APIRouter(prefix="/api/webhooks", tags=["payments"])


class PaymentAccountLinkRequest(BaseModel):
    return_url: str = Field(min_length=1)
    refresh_url: str = Field(min_length=1)
    #: Only required the first time an account is created; a reconnect
    #: against an existing `PaymentAccount` row does not need them again.
    country: str | None = Field(default=None, min_length=2, max_length=2)
    entity_type: str | None = None


class RefundRequest(BaseModel):
    amount_cents: int | None = Field(default=None, ge=1)


# ---------------------------------------------------------------- redirect safety


def _same_origin_as_app(url: str) -> bool:
    """Reject anywhere the caller names that is not this app's own origin.

    A signer never sees these URLs directly -- they are Stripe's hosted
    onboarding return/refresh links -- but an admin-supplied URL still flows
    straight into a Stripe API call, so an off-origin value here is exactly
    the shape of an open redirect (and would hand a phishing page a
    Stripe-blessed "return from onboarding" link).
    """
    base = urlsplit(get_settings().app_base_url)
    candidate = urlsplit(url)
    if not candidate.scheme or not candidate.netloc:
        return False
    return (candidate.scheme, candidate.netloc) == (base.scheme, base.netloc)


def _require_same_origin(url: str, *, field: str) -> None:
    if not _same_origin_as_app(url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field} must point back at this application.",
        )


# ---------------------------------------------------------------- account


@router.get("/account", response_model=PaymentAccountResponse | None)
def get_payment_account(
    db: Session = Depends(get_db), user: User = Depends(require_org_admin)
) -> PaymentAccountResponse | None:
    account = stripe_connect_service.get_account(db, user.organization_id)
    if account is None:
        return None
    response = PaymentAccountResponse.model_validate(account)
    response.livemode = account.livemode if account.livemode is not None else stripe_connect_service.dashboard_mode() == "live"
    return response


@router.post("/account/link", response_model=PaymentAccountLinkResponse)
def create_account_link(
    payload: PaymentAccountLinkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> PaymentAccountLinkResponse:
    _require_same_origin(payload.return_url, field="return_url")
    _require_same_origin(payload.refresh_url, field="refresh_url")
    organization = user.organization
    if stripe_connect_service.get_account(db, organization.id) is None and (
        not payload.country or not payload.entity_type
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "country and entity_type are required to create a Stripe account: "
                "they determine what Stripe requires during onboarding and cannot be "
                "changed afterwards without recreating the account."
            ),
        )
    return stripe_connect_service.create_onboarding_link(
        db,
        organization=organization,
        return_url=payload.return_url,
        refresh_url=payload.refresh_url,
        country=payload.country,
        entity_type=payload.entity_type,
    )


@router.post("/account/refresh", response_model=PaymentAccountResponse)
def refresh_payment_account(
    db: Session = Depends(get_db), user: User = Depends(require_org_admin)
) -> PaymentAccountResponse:
    account = stripe_connect_service.refresh_status(db, organization=user.organization)
    return PaymentAccountResponse.model_validate(account)


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_payment_account(
    db: Session = Depends(get_db), user: User = Depends(require_org_admin)
) -> None:
    stripe_connect_service.disconnect(db, organization=user.organization)


# ---------------------------------------------------------------- ledger
#
# Declared BEFORE the ``/{payment_id}/...`` routes so a literal path segment
# can never be swallowed as a payment id.


@router.get("/ledger", response_model=PaymentLedgerPage)
def payments_ledger(
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
    status_filter: SignerPaymentStatus | None = Query(default=None, alias="status"),
    document_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> PaymentLedgerPage:
    """Every signer payment this organization has taken, across all envelopes.

    Org-admin only. A sender's view of the payments on their *own* envelope is
    ``GET /api/documents/{id}/payments``; this is the finance view, and
    aggregating one tenant's whole cash position is an administrator's
    business rather than any member's.

    Before this existed, refunding was reachable only from one envelope's
    audit page, so money collected across many envelopes had nowhere it could
    be reviewed, reconciled or returned from -- which is how a tenant ends up
    believing no record of a payment exists at all.
    """
    base = select(SignerPayment).where(SignerPayment.organization_id == user.organization_id)
    if status_filter is not None:
        base = base.where(SignerPayment.status == status_filter)
    if document_id:
        base = base.where(SignerPayment.document_id == document_id)

    rows = list(db.scalars(base.order_by(SignerPayment.created_at.desc())).all())

    # Totals span the whole filtered set, never just the page -- see
    # `PaymentLedgerPage`. Kept per currency: a tenant taking both USD and EUR
    # has two cash positions, and one summed number would be a fiction.
    collected: dict[str, int] = {}
    refunded: dict[str, int] = {}
    succeeded_count = refunded_count = failed_count = 0
    for row in rows:
        currency = (row.currency or "USD").upper()
        if row.status in (SignerPaymentStatus.succeeded, SignerPaymentStatus.refunded):
            net = max(0, row.amount_cents - (row.refunded_amount_cents or 0))
            collected[currency] = collected.get(currency, 0) + net
            if row.refunded_amount_cents:
                refunded[currency] = refunded.get(currency, 0) + int(row.refunded_amount_cents)
        if row.status == SignerPaymentStatus.succeeded:
            succeeded_count += 1
        elif row.status == SignerPaymentStatus.refunded:
            refunded_count += 1
        elif row.status == SignerPaymentStatus.failed:
            failed_count += 1

    page = rows[offset : offset + limit]

    # Names are resolved in two batch queries rather than per row: a ledger is
    # exactly the place an N+1 turns a fast page into a slow one as a tenant's
    # payment history grows.
    document_ids = {row.document_id for row in page}
    recipient_ids = {row.recipient_id for row in page}
    receipt_rows = (
        db.scalars(
            select(PaymentReceipt).where(
                PaymentReceipt.signer_payment_id.in_([row.id for row in page])
            )
        ).all()
        if page
        else []
    )
    receipts_by_payment = {receipt.signer_payment_id: receipt for receipt in receipt_rows}
    documents = (
        {doc.id: doc for doc in db.scalars(select(Document).where(Document.id.in_(document_ids))).all()}
        if document_ids
        else {}
    )
    recipients = (
        {rec.id: rec for rec in db.scalars(select(Recipient).where(Recipient.id.in_(recipient_ids))).all()}
        if recipient_ids
        else {}
    )

    entries: list[PaymentLedgerEntry] = []
    for row in page:
        document = documents.get(row.document_id)
        recipient = recipients.get(row.recipient_id)
        entries.append(
            PaymentLedgerEntry(
                payment=SignerPaymentResponse.model_validate(row),
                receipt=_receipt_response(receipts_by_payment.get(row.id)),
                document_id=row.document_id,
                document_title=document.title if document else None,
                document_status=str(document.status) if document else None,
                # Falls back to the receipt's snapshot when the recipient row
                # is gone (reassigned, or erased under GDPR): the payer's
                # identity at the time of payment is a financial fact and must
                # not vanish from the ledger with the recipient row.
                payer_name=(recipient.name if recipient else None)
                or (receipts_by_payment.get(row.id).payer_name if receipts_by_payment.get(row.id) else None),
                payer_email=(recipient.email if recipient else None)
                or (receipts_by_payment.get(row.id).payer_email if receipts_by_payment.get(row.id) else None),
            )
        )

    return PaymentLedgerPage(
        entries=entries,
        total=len(rows),
        limit=limit,
        offset=offset,
        collected_cents_by_currency=collected,
        refunded_cents_by_currency=refunded,
        succeeded_count=succeeded_count,
        refunded_count=refunded_count,
        failed_count=failed_count,
    )


# ---------------------------------------------------------------- receipts


def _receipt_response(receipt: PaymentReceipt | None) -> PaymentReceiptResponse | None:
    """Serialise a receipt with its checksum actually re-verified.

    ``verified`` is recomputed on every read rather than trusted from a
    column, because a stored "verified" flag proves nothing about the row it
    sits in.
    """
    if receipt is None:
        return None
    response = PaymentReceiptResponse.model_validate(receipt)
    response.verified = payment_receipt_service.verify(receipt)
    return response


def _load_receipt(db: Session, *, receipt_id: str, organization_id: str) -> PaymentReceipt:
    receipt = db.get(PaymentReceipt, receipt_id)
    if receipt is None or receipt.organization_id != organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receipt not found")
    return receipt


@router.get("/receipts/{receipt_id}", response_model=PaymentReceiptResponse)
def get_receipt(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> PaymentReceiptResponse:
    response = _receipt_response(
        _load_receipt(db, receipt_id=receipt_id, organization_id=user.organization_id)
    )
    assert response is not None  # _load_receipt raises rather than returning None
    return response


@router.get("/receipts/{receipt_id}/pdf")
def download_receipt_pdf(
    receipt_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> Response:
    """The receipt as a one-page PDF, rendered on demand.

    Rendered rather than stored: the row is the record and the PDF is a view
    of it, so a refund is reflected the next time anyone downloads it. A
    stored file would be a second copy able to disagree with the refund state
    -- a receipt still reading "PAID" after the money was returned.
    """
    receipt = _load_receipt(db, receipt_id=receipt_id, organization_id=user.organization_id)
    pdf_bytes = payment_receipt_service.render_pdf(db, receipt=receipt)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{receipt.number}.pdf"'},
    )


@router.get("/{payment_id}/receipt", response_model=PaymentReceiptResponse | None)
def get_payment_receipt(
    payment_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> PaymentReceiptResponse | None:
    """This payment's receipt, or ``None`` if it has none.

    ``None`` is a real answer, not an error: an unsettled or failed payment
    never had money to receipt, and a payment settled before PAY-2 existed
    has not been backfilled yet.
    """
    payment = db.get(SignerPayment, payment_id)
    if payment is None or payment.organization_id != user.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    return _receipt_response(
        payment_receipt_service.get_for_payment(db, signer_payment_id=payment.id)
    )


@router.post("/{payment_id}/refund", response_model=SignerPaymentResponse)
def refund_payment(
    payment_id: str,
    payload: RefundRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SignerPaymentResponse:
    payment = db.get(SignerPayment, payment_id)
    if payment is None or payment.organization_id != user.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    refunded = signer_payment_service.refund(
        db, payment=payment, actor_user_id=user.id, amount_cents=payload.amount_cents
    )
    response = SignerPaymentResponse.model_validate(refunded)
    # The receipt has already been brought in line inside `refund`'s
    # transaction; returning it means the caller's UI cannot briefly show a
    # refunded payment next to a receipt still reading "PAID".
    response.receipt = _receipt_response(
        payment_receipt_service.get_for_payment(db, signer_payment_id=refunded.id)
    )
    return response


# ---------------------------------------------------------------- per-document


@document_payments_router.put("/{document_id}/payment-request", response_model=PaymentRequestResponse)
def upsert_payment_request(
    document_id: str,
    payload: PaymentRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> PaymentRequestResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    signer_payment_service.sync_request(db, document=document, payload=payload, user=user)
    summary = signer_payment_service.document_summary(db, document=document)
    assert summary is not None  # just synced
    return summary


@document_payments_router.get("/{document_id}/payment-request", response_model=PaymentRequestResponse | None)
def get_payment_request(
    document_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PaymentRequestResponse | None:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return signer_payment_service.document_summary(db, document=document)


@document_payments_router.get("/{document_id}/payments", response_model=list[SignerPaymentResponse])
def list_document_payments(
    document_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SignerPaymentResponse]:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    payments = (
        db.query(SignerPayment)
        .filter(SignerPayment.document_id == document.id, SignerPayment.organization_id == user.organization_id)
        .order_by(SignerPayment.created_at.desc())
        .all()
    )
    # Receipts are attached in one batch query so the envelope's payments
    # panel can offer the tenant's own receipt alongside Stripe's hosted one
    # -- the point of PAY-2 being that the Stripe link is a cross-reference
    # rather than the only evidence.
    receipts = (
        db.scalars(
            select(PaymentReceipt).where(
                PaymentReceipt.signer_payment_id.in_([payment.id for payment in payments])
            )
        ).all()
        if payments
        else []
    )
    by_payment = {receipt.signer_payment_id: receipt for receipt in receipts}
    responses: list[SignerPaymentResponse] = []
    for payment in payments:
        response = SignerPaymentResponse.model_validate(payment)
        response.receipt = _receipt_response(by_payment.get(payment.id))
        responses.append(response)
    return responses


# ---------------------------------------------------------------- webhook


@connect_webhook_router.post("/stripe/connect")
async def stripe_connect_webhook(request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    """Stripe Connect webhook: `account.updated` and `payment_intent.*`.

    Verified BEFORE parsing (a bad signature never reaches JSON decoding),
    unauthenticated (Stripe cannot present a bearer token), and idempotent on
    redelivery via the same `ProcessedWebhookEvent` ledger the billing
    webhook uses -- a replayed ``event.id`` is acknowledged without being
    re-applied.
    """
    raw_body = await request.body()
    signature = request.headers.get("Stripe-Signature")
    if not stripe_connect_service.verify_connect_webhook(raw_body=raw_body, signature=signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature")

    event = stripe_connect_service.parse_connect_event(raw_body=raw_body)
    event_id = str(event.get("id") or "")
    event_type = str(event.get("type") or "")
    if not event_id or not event_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook is missing id or type")

    already = db.scalar(
        select(ProcessedWebhookEvent).where(
            ProcessedWebhookEvent.provider == "stripe_connect",
            ProcessedWebhookEvent.event_id == event_id,
        )
    )
    if already:
        return {"status": "duplicate", "event_id": event_id}

    record = ProcessedWebhookEvent(
        provider="stripe_connect", event_id=event_id, event_type=event_type, payload=event
    )
    db.add(record)
    try:
        db.flush()
    except Exception:  # noqa: BLE001 - raced with a concurrent delivery
        db.rollback()
        return {"status": "duplicate", "event_id": event_id}

    data_object = ((event.get("data") or {}).get("object")) or {}
    handled = False
    if event_type.startswith("payment_intent."):
        handled = signer_payment_service.apply_webhook_event(db, event=event) is not None
    elif event_type == "account.updated":
        handled = stripe_connect_service.apply_account_updated(db, account_payload=data_object) is not None

    record.processed = handled
    record.status_code = 200
    db.add(record)
    db.commit()
    return {"status": "processed" if handled else "ignored", "event_id": event_id}
