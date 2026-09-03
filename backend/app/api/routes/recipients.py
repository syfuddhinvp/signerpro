from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, request_ip, request_user_agent
from app.core.database import get_db
from app.models.user import User
from app.schemas.recipient import (
    RecipientBulkRequest,
    RecipientCreate,
    RecipientReorderRequest,
    RecipientResponse,
    RecipientSetRequest,
    RecipientUpdate,
)
from app.services.document_service import document_service
from app.services.entitlement_service import entitlement_service
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
    # Counts the rows already attached: three sequential single adds must not
    # beat a per-document limit of three.
    entitlement_service.check_recipient_capacity(
        db, user.organization_id, document_id=document.id, additional=1
    )
    return recipient_service.create(db, document=document, user=user, payload=payload)


@router.get("", response_model=list[RecipientResponse])
def list_recipients(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[RecipientResponse]:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document.recipients


@router.put("", response_model=list[RecipientResponse])
def set_recipients(
    document_id: str,
    payload: RecipientSetRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RecipientResponse]:
    """Replace the recipient list (with signing order) in one call."""
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return recipient_service.set_all(db, document=document, user=user, payload=payload)


@router.post("/bulk", response_model=list[RecipientResponse], status_code=201)
def bulk_add_recipients(
    document_id: str,
    payload: RecipientBulkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RecipientResponse]:
    """Append recipients, optionally sourced from address-book contacts."""
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    entitlement_service.check_recipient_capacity(
        db, user.organization_id, document_id=document.id, additional=len(payload.recipients)
    )
    return recipient_service.bulk_create(db, document=document, user=user, payload=payload)


@router.post("/reorder", response_model=list[RecipientResponse])
def reorder_recipients(
    document_id: str,
    payload: RecipientReorderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RecipientResponse]:
    """Atomic signing-order rewrite; `recipient_ids` is the final order."""
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return recipient_service.reorder(db, document=document, user=user, recipient_ids=payload.recipient_ids)


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
    request: Request,
    notify: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Issue a fresh signing link for one recipient.

    ``notify=true`` (the default) emails it as a resend. ``notify=false`` mints
    it and hands it back without sending anything, which is what "copy link"
    needs: sharing a link out-of-band should not put a second copy of it in the
    recipient's inbox.

    Either way the previous link for that recipient is superseded, so there is
    never more than one live URL per signer.
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
    raw_token, _ = token_service.create_for_recipient(
        db,
        document_id=document.id,
        recipient_id=recipient.id,
        expires_at=document.expires_at,
    )
    if notify:
        link = signflow_email_service.send_signing_link(document=document, recipient=recipient, token=raw_token)
    else:
        link = signflow_email_service.signing_link_for(token=raw_token)

    # Log to audit trail. The distinction matters when the trail is read back:
    # one is an email the recipient received, the other a link the sender took.
    audit_service.log(
        db,
        document_id=document.id,
        recipient_id=recipient.id,
        user_id=user.id,
        event_type="signer_email_sent" if notify else "signing_link_issued",
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
        event_message=(
            f"Signing link manually resent to {recipient.email}."
            if notify
            else f"Signing link copied by the sender for {recipient.email}; no email was sent."
        ),
    )
    db.commit()

    return {"email": recipient.email, "signing_link": link}


