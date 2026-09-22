from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.contact import Contact
from app.models.document import Document
from app.models.enums import DocumentStatus, RecipientStatus, is_signing_role
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.recipient import (
    RecipientBulkRequest,
    RecipientCreate,
    RecipientSetRequest,
    RecipientUpdate,
    SigningLinkResponse,
)
from app.services.audit_service import audit_service
from app.services.document_service import document_service


#: A signing link only makes sense once the envelope has actually gone out,
#: and only while it is still in flight (mirrors ``resend_recipient_link``'s
#: gate in app/api/routes/recipients.py).
_LINK_ELIGIBLE_DOCUMENT_STATUSES = {
    DocumentStatus.sent,
    DocumentStatus.viewed,
    DocumentStatus.partially_completed,
}

#: Recipient states with no signing obligation left: nothing to click through.
_LINK_INELIGIBLE_RECIPIENT_STATUSES = {RecipientStatus.completed, RecipientStatus.declined}


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
            role=payload.role,
            color=payload.color,
            contact_id=self._validated_contact_id(db, document=document, contact_id=payload.contact_id),
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
        if payload.role is not None:
            recipient.role = payload.role
        if payload.color is not None:
            recipient.color = payload.color
        if "contact_id" in payload.model_fields_set:
            recipient.contact_id = self._validated_contact_id(db, document=document, contact_id=payload.contact_id)
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

    def _validated_contact_id(self, db: Session, *, document: Document, contact_id: str | None) -> str | None:
        if contact_id is None:
            return None
        contact = db.get(Contact, contact_id)
        if not contact or contact.organization_id != document.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
        return contact_id

    # ------------------------------------------------------------------
    # Full-list replace (RTE-2 companion), reorder (RTE-2), bulk (RTE-4)
    # ------------------------------------------------------------------

    def set_all(self, db: Session, *, document: Document, user: User, payload: RecipientSetRequest) -> list[Recipient]:
        """Replace the recipient list, signing order included, in one call.

        Items carrying a known ``id`` are updated in place so signing progress
        survives; unnamed existing recipients (and their fields) are removed.
        """
        document_service.ensure_editable(document)
        if not payload.recipients:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one recipient is required")
        # Blanks are excluded on purpose: a template legitimately carries several
        # unassigned role placeholders, and they are not duplicates of each other.
        emails = [item.email.lower() for item in payload.recipients if item.email]
        duplicates = {email for email in emails if emails.count(email) > 1}
        if duplicates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Duplicate recipient email(s): {', '.join(sorted(duplicates))}",
            )
        existing = {recipient.id: recipient for recipient in document.recipients}
        seen: set[str] = set()
        result: list[Recipient] = []
        for index, item in enumerate(payload.recipients, start=1):
            contact_id = self._validated_contact_id(db, document=document, contact_id=item.contact_id)
            order = item.signing_order or index
            if item.id and item.id in existing:
                recipient = existing[item.id]
                recipient.name = item.name
                recipient.email = item.email.lower()
                # Unlike the rest of the row, the role label is only overwritten
                # when the caller actually sent one. It is the last thing that
                # identifies an unassigned placeholder, and a client that does
                # not model role names at all should not silently erase it.
                if "role_name" in item.model_fields_set:
                    recipient.role_name = item.role_name
                recipient.role = item.role
                recipient.color = item.color
                recipient.contact_id = contact_id
                recipient.signing_order = order
                recipient.otp_enabled = item.otp_enabled
                recipient.phone_number = item.phone_number
                seen.add(recipient.id)
            else:
                if item.id and item.id not in existing:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Recipient {item.id} does not belong to this document",
                    )
                recipient = Recipient(
                    document_id=document.id,
                    name=item.name,
                    email=item.email.lower(),
                    role_name=item.role_name,
                    role=item.role,
                    color=item.color,
                    contact_id=contact_id,
                    signing_order=order,
                    otp_enabled=item.otp_enabled,
                    phone_number=item.phone_number,
                    status=RecipientStatus.waiting,
                )
                db.add(recipient)
                db.flush()
                seen.add(recipient.id)
            result.append(recipient)
        removed = 0
        for recipient_id, recipient in existing.items():
            if recipient_id not in seen:
                db.delete(recipient)
                removed += 1
        if payload.workflow_type is not None:
            document.workflow_type = payload.workflow_type
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="recipient_added",
            event_message=f"Recipient list saved ({len(result)} recipient(s), {removed} removed).",
            metadata={"saved": len(result), "removed": removed},
        )
        db.commit()
        db.refresh(document)
        return sorted(document.recipients, key=lambda item: (item.signing_order, item.created_at))

    def reorder(self, db: Session, *, document: Document, user: User, recipient_ids: list[str]) -> list[Recipient]:
        document_service.ensure_editable(document)
        current = {recipient.id: recipient for recipient in document.recipients}
        if len(set(recipient_ids)) != len(recipient_ids):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate recipient ids in reorder")
        if set(recipient_ids) != set(current):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="recipient_ids must list every recipient on this document exactly once",
            )
        for position, recipient_id in enumerate(recipient_ids, start=1):
            current[recipient_id].signing_order = position
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="recipients_reordered",
            event_message="Recipient signing order was changed.",
            metadata={"order": recipient_ids},
        )
        db.commit()
        db.refresh(document)
        return sorted(document.recipients, key=lambda item: item.signing_order)

    def bulk_create(self, db: Session, *, document: Document, user: User, payload: RecipientBulkRequest) -> list[Recipient]:
        document_service.ensure_editable(document)
        items = list(payload.recipients)
        if payload.from_contact_ids:
            contacts = list(
                db.scalars(
                    select(Contact).where(
                        Contact.id.in_(payload.from_contact_ids),
                        Contact.organization_id == document.organization_id,
                    )
                ).unique()
            )
            found = {contact.id for contact in contacts}
            missing = [cid for cid in payload.from_contact_ids if cid not in found]
            if missing:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
            for contact in contacts:
                items.append(
                    RecipientCreate(
                        name=contact.name,
                        email=contact.email,
                        role=contact.default_role if contact.default_role in {"sign", "approve", "copy", "inperson"} else "sign",
                        color=contact.color,
                        contact_id=contact.id,
                        phone_number=contact.phone,
                    )
                )
        if not items:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No recipients supplied")
        existing_emails = {recipient.email.lower() for recipient in document.recipients}
        next_order = max((recipient.signing_order for recipient in document.recipients), default=0)
        created: list[Recipient] = []
        for item in items:
            email = item.email.lower()
            if email in existing_emails:
                continue
            existing_emails.add(email)
            next_order += 1
            recipient = Recipient(
                document_id=document.id,
                name=item.name,
                email=email,
                role_name=item.role_name,
                role=item.role,
                color=item.color,
                contact_id=self._validated_contact_id(db, document=document, contact_id=item.contact_id),
                signing_order=next_order,
                otp_enabled=item.otp_enabled,
                phone_number=item.phone_number,
            )
            db.add(recipient)
            db.flush()
            created.append(recipient)
            audit_service.log(
                db,
                document_id=document.id,
                recipient_id=recipient.id,
                user_id=user.id,
                event_type="recipient_added",
                event_message=f"Recipient {recipient.email} was added.",
            )
        db.commit()
        db.refresh(document)
        return created

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

    def issue_signing_link(self, db: Session, *, document: Document, user: User, recipient_id: str) -> SigningLinkResponse:
        """Mint a fresh signing URL for one recipient, for the sender to copy.

        Reuses ``token_service.create_for_recipient`` exactly as the resend
        flow does, which means the recipient's previously-issued link (if any)
        is revoked as a side effect. That is the point, not a bug: at most one
        live signing URL should exist per recipient. The audit trail records
        who took it.
        """
        from app.services.email_service import signflow_email_service
        from app.services.token_service import token_service

        if document.status not in _LINK_ELIGIBLE_DOCUMENT_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot issue a signing link for a document that has not been sent.",
            )
        recipient = self.get(document, recipient_id)
        if not is_signing_role(recipient.role):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This recipient is a copy-only recipient with no signing link.",
            )
        if recipient.status in _LINK_INELIGIBLE_RECIPIENT_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This recipient has already completed or declined; there is nothing left to sign.",
            )
        raw_token, signing_token = token_service.create_for_recipient(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            expires_at=document.expires_at,
        )
        url = signflow_email_service.signing_link_for(token=raw_token)
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            user_id=user.id,
            event_type="signing_link_issued",
            event_message=(
                f"Signing link copied by {user.email} for {recipient.email}; "
                "any previously issued link for them was invalidated."
            ),
        )
        db.commit()
        return SigningLinkResponse(url=url, expires_at=signing_token.expires_at)


recipient_service = RecipientService()

