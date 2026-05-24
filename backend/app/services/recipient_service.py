from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.recipient import RecipientCreate, RecipientUpdate
from app.services.audit_service import audit_service
from app.services.document_service import document_service


class RecipientService:
    def create(self, db: Session, *, document: Document, user: User, payload: RecipientCreate) -> Recipient:
        document_service.ensure_editable(document)
        recipient = Recipient(
            document_id=document.id,
            name=payload.name,
            email=payload.email.lower(),
            role_name=payload.role_name,
            signing_order=payload.signing_order,
            otp_enabled=payload.otp_enabled,
            phone_number=payload.phone_number,
        )
        db.add(recipient)
        db.flush()
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            user_id=user.id,
            event_type="recipient_added",
            event_message=f"Recipient {recipient.email} was added.",
        )
        db.commit()
        db.refresh(recipient)
        return recipient

    def get(self, document: Document, recipient_id: str) -> Recipient:
        recipient = next((item for item in document.recipients if item.id == recipient_id), None)
        if not recipient:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")
        return recipient

    def update(self, db: Session, *, document: Document, user: User, recipient_id: str, payload: RecipientUpdate) -> Recipient:
        document_service.ensure_editable(document)
        recipient = self.get(document, recipient_id)
        if payload.name is not None:
            recipient.name = payload.name
        if payload.email is not None:
            recipient.email = payload.email.lower()
        if payload.role_name is not None:
            recipient.role_name = payload.role_name
        if payload.signing_order is not None:
            recipient.signing_order = payload.signing_order
        if payload.otp_enabled is not None:
            recipient.otp_enabled = payload.otp_enabled
        if payload.phone_number is not None:
            recipient.phone_number = payload.phone_number
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            user_id=user.id,
            event_type="recipient_added",
            event_message=f"Recipient {recipient.email} was updated.",
        )
        db.commit()
        db.refresh(recipient)
        return recipient

    def delete(self, db: Session, *, document: Document, user: User, recipient_id: str) -> None:
        document_service.ensure_editable(document)
        recipient = self.get(document, recipient_id)
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            user_id=user.id,
            event_type="recipient_added",
            event_message=f"Recipient {recipient.email} was deleted.",
        )
        db.delete(recipient)
        db.commit()


recipient_service = RecipientService()

