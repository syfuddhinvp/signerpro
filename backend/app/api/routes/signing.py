from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import request_ip, request_user_agent
from app.core.database import get_db
from app.core.storage import storage
from app.schemas.field import FieldResponse
from app.schemas.signer import (
    CompletionResponse,
    DeclineRequest,
    FieldValueRequest,
    OtpVerifyRequest,
    SignatureRequest,
    SigningSessionResponse,
)
from app.services.signing_service import signing_service


router = APIRouter(prefix="/api/sign", tags=["signing"])


@router.get("/{token}", response_model=SigningSessionResponse)
def get_signing_session(token: str, db: Session = Depends(get_db)) -> SigningSessionResponse:
    signing_token, document, recipient = signing_service.load_session(db, raw_token=token)
    return signing_service.session_response(raw_token=token, signing_token=signing_token, document=document, recipient=recipient)


@router.get("/{token}/pdf")
def signer_pdf(token: str, db: Session = Depends(get_db)) -> FileResponse:
    _, document, recipient = signing_service.load_session(db, raw_token=token)
    if recipient.otp_enabled and not recipient.otp_verified:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OTP verification required")
    if not recipient.consent_accepted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Consent confirmation required")
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


@router.post("/{token}/otp/send", status_code=204)
def send_otp(token: str, db: Session = Depends(get_db)) -> None:
    signing_service.send_otp(db, raw_token=token)


@router.post("/{token}/otp/verify", response_model=SigningSessionResponse)
def verify_otp(token: str, payload: OtpVerifyRequest, db: Session = Depends(get_db)) -> SigningSessionResponse:
    signing_service.verify_otp(db, raw_token=token, code=payload.code)
    signing_token, document, recipient = signing_service.load_session(db, raw_token=token)
    return signing_service.session_response(raw_token=token, signing_token=signing_token, document=document, recipient=recipient)


@router.post("/{token}/consent", response_model=SigningSessionResponse)
def accept_consent(token: str, request: Request, db: Session = Depends(get_db)) -> SigningSessionResponse:
    signing_service.accept_consent(
        db,
        raw_token=token,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )
    signing_token, document, recipient = signing_service.load_session(db, raw_token=token)
    return signing_service.session_response(raw_token=token, signing_token=signing_token, document=document, recipient=recipient)

