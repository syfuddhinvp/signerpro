from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.recipient import RecipientCreate, RecipientResponse, RecipientUpdate
from app.services.document_service import document_service
from app.services.recipient_service import recipient_service


router = APIRouter(prefix="/api/documents/{document_id}/recipients", tags=["recipients"])


@router.post("", response_model=RecipientResponse, status_code=201)
def create_recipient(
    document_id: str,
    payload: RecipientCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RecipientResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return recipient_service.create(db, document=document, user=user, payload=payload)


@router.get("", response_model=list[RecipientResponse])
def list_recipients(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[RecipientResponse]:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document.recipients


@router.patch("/{recipient_id}", response_model=RecipientResponse)
def update_recipient(
    document_id: str,
    recipient_id: str,
    payload: RecipientUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RecipientResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return recipient_service.update(db, document=document, user=user, recipient_id=recipient_id, payload=payload)


@router.delete("/{recipient_id}", status_code=204)
def delete_recipient(document_id: str, recipient_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    recipient_service.delete(db, document=document, user=user, recipient_id=recipient_id)


@router.post("/{recipient_id}/resend")
def resend_recipient_link(
    document_id: str,
    recipient_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """
    Manually resend the signing link to an individual recipient.
    Returns the generated secure signing link for manual copy/share.
    """
    from app.services.token_service import token_service
    from app.services.email_service import signflow_email_service
    from app.services.audit_service import audit_service
    from app.models.enums import DocumentStatus
    from fastapi import HTTPException, status

    document = document_service.get_for_user(db, document_id=document_id, user=user)
    
    # Verify document is in an active state
    if document.status not in {DocumentStatus.sent, DocumentStatus.viewed, DocumentStatus.partially_completed}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot resend signing link for a document that is not active."
        )

    recipient = next((r for r in document.recipients if r.id == recipient_id), None)
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")

    # Generate token & link
    raw_token, _ = token_service.create_for_recipient(db, document_id=document.id, recipient_id=recipient.id)
    link = signflow_email_service.send_signing_link(document=document, recipient=recipient, token=raw_token)

    # Log to audit trail
    audit_service.log(
        db,
        document_id=document.id,
        recipient_id=recipient.id,
        user_id=user.id,
        event_type="signer_email_sent",
        event_message=f"Signing link manually resent/shared for {recipient.email}.",
    )
    db.commit()

    return {"email": recipient.email, "signing_link": link}


