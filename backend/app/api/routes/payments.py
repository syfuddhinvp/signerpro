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

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.config import get_settings
from app.core.database import get_db
from app.models.subscription import ProcessedWebhookEvent
from app.models.payment_account import PaymentAccount
from app.models.signer_payment import SignerPayment
from app.models.user import User
from app.schemas.payment import (
    PaymentAccountLinkResponse,
    PaymentAccountResponse,
    PaymentRequestCreate,
    PaymentRequestResponse,
    SignerPaymentResponse,
)
from app.services.document_service import document_service
from app.services.signer_payment_service import signer_payment_service
from app.services.stripe_connect_service import stripe_connect_service

router = APIRouter(prefix="/api/payments", tags=["payments"])
document_payments_router = APIRouter(prefix="/api/documents", tags=["payments"])
connect_webhook_router = APIRouter(prefix="/api/webhooks", tags=["payments"])


class PaymentAccountLinkRequest(BaseModel):
    return_url: str = Field(min_length=1)
    refresh_url: str = Field(min_length=1)


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
    return stripe_connect_service.create_onboarding_link(
        db,
        organization=organization,
        return_url=payload.return_url,
        refresh_url=payload.refresh_url,
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
    return SignerPaymentResponse.model_validate(refunded)


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
    return [SignerPaymentResponse.model_validate(payment) for payment in payments]


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
