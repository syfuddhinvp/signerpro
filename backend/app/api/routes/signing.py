from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import request_ip, request_user_agent
from app.core.database import get_db
from app.core.ratelimit import RateLimiter, otp_send_limiter, otp_verify_limiter, path_param_key, signing_session_limiter
from app.core.storage import storage
from app.models.enums import DocumentStatus
from app.schemas.field import FieldResponse
from app.schemas.payment import PaymentIntentResponse, SignerPaymentResponse
from app.schemas.signer import (
    AttachmentUploadResponse,
    CompletionResponse,
    DeclineRequest,
    FieldValueRequest,
    OtpVerifyRequest,
    ReassignRequest,
    ReassignResponse,
    SignatureRequest,
    SigningSessionResponse,
)
from app.services.signer_payment_service import signer_payment_service
from app.services.signing_service import signing_service

#: Creating a PaymentIntent hits Stripe and mints a real, chargeable object --
#: unlike the read-only ``/payments/{field_id}`` GET, it must not be
#: spammable by whoever holds a signing link. Keyed by the token itself, like
#: the OTP limiters.
payment_intent_limiter = RateLimiter(
    name="payment_intent",
    limit=20,
    window_seconds=600,
    key_func=path_param_key("token"),
    detail="Too many payment attempts. Please wait before trying again.",
)


router = APIRouter(prefix="/api/sign", tags=["signing"])


@router.get("/{token}", response_model=SigningSessionResponse, dependencies=[Depends(signing_session_limiter)])
def get_signing_session(token: str, db: Session = Depends(get_db)) -> SigningSessionResponse:
    signing_token, document, recipient = signing_service.load_session(db, raw_token=token)
    return signing_service.session_response(raw_token=token, signing_token=signing_token, document=document, recipient=recipient, db=db)


@router.get("/{token}/pdf")
def signer_pdf(token: str, db: Session = Depends(get_db)) -> FileResponse:
    """The document as this signer is entitled to see it.

    SIGN-4/SIGN-8 policy decision: the token is deliberately *not* revoked on
    completion. A signer who has just executed an agreement is the party with
    the strongest claim to a copy of it, and revoking on ``complete`` left them
    with no route to one at all — the sender-side ``final-pdf`` endpoint needs a
    session they do not have. What the link loses at completion is the ability
    to *write*: ``_ensure_can_edit`` already rejects every mutating call once
    the recipient is completed, and the link still dies at the envelope
    deadline (and is superseded on resend/reassign).

    Once the envelope is executed this serves the **signed** PDF rather than
    the blank original, which is what the completion card has always promised.
    """
    _, document, recipient = signing_service.load_session(db, raw_token=token)
    if recipient.otp_enabled and not recipient.otp_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OTP verification required")
    if not recipient.consent_accepted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Consent confirmation required")
    if document.status == DocumentStatus.completed and document.final_file_path:
        return FileResponse(
            storage.path(document.final_file_path),
            media_type="application/pdf",
            filename=f"{document.title}-signed.pdf",
        )
    if not document.original_file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF is not available")
    return FileResponse(storage.path(document.original_file_path), media_type="application/pdf", filename=f"{document.title}.pdf")


@router.post("/{token}/viewed", response_model=SigningSessionResponse)
def mark_viewed(token: str, request: Request, db: Session = Depends(get_db)) -> SigningSessionResponse:
    return signing_service.mark_viewed(
        db,
        raw_token=token,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.post("/{token}/fields/{field_id}/value", response_model=FieldResponse)
def save_field_value(
    token: str,
    field_id: str,
    payload: FieldValueRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> FieldResponse:
    return signing_service.save_field_value(
        db,
        raw_token=token,
        field_id=field_id,
        payload=payload,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.post("/{token}/fields/{field_id}/signature", response_model=FieldResponse)
def save_signature(
    token: str,
    field_id: str,
    payload: SignatureRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> FieldResponse:
    return signing_service.save_signature(
        db,
        raw_token=token,
        field_id=field_id,
        payload=payload,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.get("/{token}/fields/{field_id}/attachment")
def read_attachment(token: str, field_id: str, db: Session = Depends(get_db)) -> FileResponse:
    """The file this signer uploaded, so a stamp survives a page reload."""
    attachment = signing_service.attachment_file(db, raw_token=token, field_id=field_id)
    return FileResponse(
        storage.path(attachment.file_path),
        media_type=attachment.content_type or "application/octet-stream",
        filename=attachment.filename,
    )


@router.post("/{token}/fields/{field_id}/attachment", response_model=AttachmentUploadResponse)
async def save_attachment(
    token: str,
    field_id: str,
    request: Request,
    upload: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> AttachmentUploadResponse:
    """Signer-side file upload for an ``attachment`` field (FLD-6)."""
    return await signing_service.save_attachment(
        db,
        raw_token=token,
        field_id=field_id,
        upload=upload,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.post("/{token}/complete", response_model=CompletionResponse)
def complete(token: str, request: Request, db: Session = Depends(get_db)) -> CompletionResponse:
    return signing_service.complete(
        db,
        raw_token=token,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.post("/{token}/decline", status_code=204)
def decline(token: str, payload: DeclineRequest, request: Request, db: Session = Depends(get_db)) -> None:
    signing_service.decline(
        db,
        raw_token=token,
        payload=payload,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.post("/{token}/reassign", response_model=ReassignResponse)
def reassign(token: str, payload: ReassignRequest, request: Request, db: Session = Depends(get_db)) -> ReassignResponse:
    return signing_service.reassign(
        db,
        raw_token=token,
        payload=payload,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.post("/{token}/otp/send", status_code=204, dependencies=[Depends(otp_send_limiter)])
def send_otp(token: str, db: Session = Depends(get_db)) -> None:
    signing_service.send_otp(db, raw_token=token)


@router.post("/{token}/otp/verify", response_model=SigningSessionResponse, dependencies=[Depends(otp_verify_limiter)])
def verify_otp(token: str, payload: OtpVerifyRequest, db: Session = Depends(get_db)) -> SigningSessionResponse:
    signing_service.verify_otp(db, raw_token=token, code=payload.code)
    signing_token, document, recipient = signing_service.load_session(db, raw_token=token)
    return signing_service.session_response(raw_token=token, signing_token=signing_token, document=document, recipient=recipient, db=db)


@router.post("/{token}/consent", response_model=SigningSessionResponse)
def accept_consent(token: str, request: Request, db: Session = Depends(get_db)) -> SigningSessionResponse:
    signing_service.accept_consent(
        db,
        raw_token=token,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )
    signing_token, document, recipient = signing_service.load_session(db, raw_token=token)
    return signing_service.session_response(raw_token=token, signing_token=signing_token, document=document, recipient=recipient, db=db)


# ---------------------------------------------------------------------------
# Signer-side payments (PAY-1). ``/refresh`` exists because a webhook can
# arrive late -- or never, in a local/dev setup with nothing pointing a live
# Stripe endpoint back at this machine -- while the signer is standing there
# watching the Pay button, waiting for it to turn green. Polling once after
# Stripe confirms the client-side charge closes that gap without depending on
# the webhook at all.
# ---------------------------------------------------------------------------


class PaymentIntentRequest(BaseModel):
    #: Only consulted for a ``signer_entered`` field; the service clamps/
    #: validates it against the field's own bounds and otherwise ignores it
    #: entirely (a ``fixed`` field always charges its own configured amount).
    amount_cents: int | None = None


@router.post(
    "/{token}/payments/{field_id}/intent",
    response_model=PaymentIntentResponse,
    dependencies=[Depends(payment_intent_limiter)],
)
def create_payment_intent(
    token: str,
    field_id: str,
    payload: PaymentIntentRequest = PaymentIntentRequest(),
    db: Session = Depends(get_db),
) -> PaymentIntentResponse:
    return signer_payment_service.create_intent(
        db, raw_token=token, field_id=field_id, amount_cents=payload.amount_cents
    )


@router.post("/{token}/payments/{field_id}/refresh", response_model=SignerPaymentResponse)
def refresh_payment(token: str, field_id: str, db: Session = Depends(get_db)) -> SignerPaymentResponse:
    payment = signer_payment_service.refresh_payment(db, raw_token=token, field_id=field_id)
    return SignerPaymentResponse.model_validate(payment)


@router.get("/{token}/payments/{field_id}", response_model=SignerPaymentResponse | None)
def get_payment(token: str, field_id: str, db: Session = Depends(get_db)) -> SignerPaymentResponse | None:
    signing_token, document, recipient = signing_service.load_session(db, raw_token=token)
    field = signing_service._get_owned_field(document, recipient, field_id)
    payment = signer_payment_service.settled_payment(db, field=field)
    if payment is None:
        # Fall back to the latest attempt (e.g. still processing) so the
        # signer's UI can show *something* other than a blank slate.
        payment = signer_payment_service._latest_succeeded_or_processing(db, field_id=field.id)
    return SignerPaymentResponse.model_validate(payment) if payment is not None else None

