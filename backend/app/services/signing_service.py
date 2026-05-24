from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.document import Document
from app.models.enums import DocumentStatus, FieldType, RecipientStatus, SignatureType, WorkflowType
from app.models.field import Field
from app.models.recipient import Recipient
from app.models.signature import Signature
from app.models.signing_token import SigningToken
from app.schemas.signer import CompletionResponse, DeclineRequest, FieldValueRequest, SignatureRequest, SigningSessionResponse
from app.services.audit_service import audit_service
from app.services.email_service import signflow_email_service
from app.services.pdf_service import pdf_service
from app.services.token_service import token_service


class SigningService:
    def load_session(self, db: Session, *, raw_token: str) -> tuple[SigningToken, Document, Recipient]:
        signing_token = token_service.get_valid_token(db, raw_token)
        document = signing_token.document
        recipient = signing_token.recipient
        if document.status in {DocumentStatus.voided, DocumentStatus.expired, DocumentStatus.declined}:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Document is no longer available for signing")
        if recipient.status == RecipientStatus.waiting:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This recipient is not ready to sign yet")
        return signing_token, document, recipient

    def session_response(self, *, raw_token: str, signing_token: SigningToken, document: Document, recipient: Recipient) -> SigningSessionResponse:
        read_only = recipient.status == RecipientStatus.completed or document.status == DocumentStatus.completed
        otp_required = recipient.otp_enabled and not recipient.otp_verified and not read_only
        consent_required = not recipient.consent_accepted and not read_only

        required_fields = [field for field in document.fields if field.recipient_id == recipient.id and field.required]
        completed = sum(1 for field in required_fields if self._field_has_value(field))

        fields = document.fields if not otp_required and not consent_required else []
        pdf_url = f"/api/sign/{raw_token}/pdf" if not otp_required and not consent_required else ""

        return SigningSessionResponse(
            document={
                "title": document.title,
                "status": document.status,
                "workflow_type": document.workflow_type,
                "page_count": document.page_count,
            },
            recipient={
                "name": recipient.name,
                "email": recipient.email,
                "role_name": recipient.role_name,
                "status": recipient.status,
            },
            current_recipient_id=recipient.id,
            fields=fields,
            read_only=read_only,
            expires_at=signing_token.expires_at,
            pdf_url=pdf_url,
            required_total=len(required_fields),
            required_completed=completed,
            otp_required=otp_required,
            consent_required=consent_required,
        )

    def mark_viewed(
        self,
        db: Session,
        *,
        raw_token: str,
        ip_address: str | None,
        user_agent: str | None,
    ) -> SigningSessionResponse:
        signing_token, document, recipient = self.load_session(db, raw_token=raw_token)
        if recipient.status not in {RecipientStatus.completed, RecipientStatus.viewed}:
            recipient.status = RecipientStatus.viewed
            recipient.viewed_at = datetime.now(timezone.utc)
            if document.status == DocumentStatus.sent:
                document.status = DocumentStatus.viewed
            audit_service.log(
                db,
                document_id=document.id,
                recipient_id=recipient.id,
                event_type="document_viewed",
                event_message=f"{recipient.email} viewed the document.",
                ip_address=ip_address,
                user_agent=user_agent,
            )
            db.commit()
            db.refresh(document)
        return self.session_response(raw_token=raw_token, signing_token=signing_token, document=document, recipient=recipient)

    def save_field_value(
        self,
        db: Session,
        *,
        raw_token: str,
        field_id: str,
        payload: FieldValueRequest,
        ip_address: str | None,
        user_agent: str | None,
    ) -> Field:
        _, document, recipient = self.load_session(db, raw_token=raw_token)
        self._ensure_can_edit(document, recipient)
        field = self._get_owned_field(document, recipient, field_id)
        if field.type == FieldType.signature:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use the signature endpoint for signature fields")
        if field.type == FieldType.checkbox:
            field.value = "true" if bool(payload.value) else "false"
        else:
            field.value = str(payload.value).strip()
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="field_completed",
            event_message=f"Field '{field.label}' was completed by {recipient.email}.",
            ip_address=ip_address,
            user_agent=user_agent,
            metadata={"field_id": field.id},
        )
        db.commit()
        db.refresh(field)
        return field

    def save_signature(
        self,
        db: Session,
        *,
        raw_token: str,
        field_id: str,
        payload: SignatureRequest,
        ip_address: str | None,
        user_agent: str | None,
    ) -> Field:
        _, document, recipient = self.load_session(db, raw_token=raw_token)
        self._ensure_can_edit(document, recipient)
        field = self._get_owned_field(document, recipient, field_id)
        if field.type != FieldType.signature:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field is not a signature field")
        image_path = None
        signature_text = payload.signature_text.strip() if payload.signature_text else None
        if payload.signature_type == SignatureType.typed and not signature_text:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Typed signature text is required")
        if payload.signature_type == SignatureType.drawn:
            if not payload.signature_image_base64:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Drawn signature image is required")
            image_path = pdf_service.save_drawn_signature(
                document_id=document.id,
                recipient_id=recipient.id,
                field_id=field.id,
                data_url_or_base64=payload.signature_image_base64,
            )
            signature_text = signature_text or recipient.name
        signature = Signature(
            document_id=document.id,
            recipient_id=recipient.id,
            field_id=field.id,
            signature_type=payload.signature_type,
            signature_text=signature_text,
            signature_image_path=image_path,
        )
        db.add(signature)
        field.value = signature_text or "drawn_signature"
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="signature_added",
            event_message=f"Signature added by {recipient.email}.",
            ip_address=ip_address,
            user_agent=user_agent,
            metadata={"field_id": field.id, "signature_type": payload.signature_type},
        )
        db.commit()
        db.refresh(field)
        return field

    def complete(
        self,
        db: Session,
        *,
        raw_token: str,
        ip_address: str | None,
        user_agent: str | None,
    ) -> CompletionResponse:
        signing_token, document, recipient = self.load_session(db, raw_token=raw_token)
        self._ensure_can_edit(document, recipient)
        missing = [field.label for field in document.fields if field.recipient_id == recipient.id and field.required and not self._field_has_value(field)]
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Required fields are incomplete: {', '.join(missing)}")
        recipient.status = RecipientStatus.completed
        recipient.completed_at = datetime.now(timezone.utc)
        signing_token.used_at = recipient.completed_at
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="recipient_completed",
            event_message=f"{recipient.email} completed signing.",
            ip_address=ip_address,
            user_agent=user_agent,
        )

        from app.services.crm_service import crm_integration_service
        crm_integration_service.trigger_signer_completed(db, document=document, recipient=recipient)

        if all(item.status == RecipientStatus.completed for item in document.recipients):
            pdf_service.generate_final_pdf(db, document=document)
            crm_integration_service.trigger_document_completed(db, document=document)
            final_url = f"/api/documents/{document.id}/final-pdf"
        else:
            document.status = DocumentStatus.partially_completed
            self._activate_next_sequential_group(db, document)
            final_url = None
        db.commit()
        return CompletionResponse(
            document_status=document.status,
            recipient_status=recipient.status,
            final_pdf_url=final_url,
        )

    def decline(
        self,
        db: Session,
        *,
        raw_token: str,
        payload: DeclineRequest,
        ip_address: str | None,
        user_agent: str | None,
    ) -> None:
        _, document, recipient = self.load_session(db, raw_token=raw_token)
        self._ensure_can_edit(document, recipient)
        recipient.status = RecipientStatus.declined
        recipient.declined_at = datetime.now(timezone.utc)
        recipient.decline_reason = payload.reason
        document.status = DocumentStatus.declined
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="document_declined",
            event_message=f"{recipient.email} declined to sign.",
            ip_address=ip_address,
            user_agent=user_agent,
            metadata={"reason": payload.reason},
        )
        db.commit()

    def _activate_next_sequential_group(self, db: Session, document: Document) -> None:
        if document.workflow_type != WorkflowType.sequential:
            return
        waiting_orders = sorted({recipient.signing_order for recipient in document.recipients if recipient.status == RecipientStatus.waiting})
        if not waiting_orders:
            return
        next_order = waiting_orders[0]
        lower_order_recipients = [recipient for recipient in document.recipients if recipient.signing_order < next_order]
        if any(recipient.status != RecipientStatus.completed for recipient in lower_order_recipients):
            return
        for next_recipient in [item for item in document.recipients if item.signing_order == next_order]:
            next_recipient.status = RecipientStatus.sent
            raw_token, _ = token_service.create_for_recipient(db, document_id=document.id, recipient_id=next_recipient.id)
            signflow_email_service.send_signing_link(document=document, recipient=next_recipient, token=raw_token, db=db)
            audit_service.log(
                db,
                document_id=document.id,
                recipient_id=next_recipient.id,
                event_type="signer_email_sent",
                event_message=f"Sequential signing link sent to {next_recipient.email}.",
            )

    def _ensure_can_edit(self, document: Document, recipient: Recipient) -> None:
        if document.status == DocumentStatus.completed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed documents cannot be edited")
        if recipient.status == RecipientStatus.completed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Recipient has already completed signing")
        if recipient.status not in {RecipientStatus.sent, RecipientStatus.viewed}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Recipient cannot sign in current status")
        if recipient.otp_enabled and not recipient.otp_verified:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OTP verification required")
        if not recipient.consent_accepted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Consent confirmation required")

    def _get_owned_field(self, document: Document, recipient: Recipient, field_id: str) -> Field:
        field = next((item for item in document.fields if item.id == field_id), None)
        if not field:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
        if field.recipient_id != recipient.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Signer cannot edit another recipient's field")
        if field.is_locked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Field is locked")
        return field

    def _field_has_value(self, field: Field) -> bool:
        if field.type == FieldType.checkbox:
            return str(field.value).lower() == "true"
        return bool(field.value and str(field.value).strip())

    def send_otp(self, db: Session, *, raw_token: str) -> None:
        signing_token, document, recipient = self.load_session(db, raw_token=raw_token)
        if recipient.status == RecipientStatus.completed or document.status == DocumentStatus.completed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot send OTP for completed sessions")

        import secrets
        from datetime import timedelta

        otp_code = "".join(secrets.choice("0123456789") for _ in range(6))
        recipient.otp_code = otp_code
        recipient.otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

        # Load organization settings for gateway dispatch
        from app.models.organization import Organization
        org = db.get(Organization, document.organization_id)

        # Dispatch via SMS if phone is available, otherwise fall back to Email dispatch
        if recipient.phone_number:
            from app.services.sms_service import sms_service
            sms_service.send_sms(
                to_phone=recipient.phone_number,
                body=f"Your SignFlow CRM document verification code is: {otp_code}. Valid for 10 minutes.",
                organization=org
            )
        else:
            from app.core.email import email_service, EmailMessage
            email_service.send(
                EmailMessage(
                    to_email=recipient.email,
                    subject="SignFlow Verification Code",
                    body=f"Hello {recipient.name},\n\nYour secure verification code is: {otp_code}\n\nThis code will expire in 10 minutes."
                ),
                organization=org
            )

        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="signer_otp_sent",
            event_message=f"OTP code sent to {recipient.email}.",
        )
        db.commit()

    def verify_otp(self, db: Session, *, raw_token: str, code: str) -> None:
        signing_token, document, recipient = self.load_session(db, raw_token=raw_token)
        if not recipient.otp_enabled:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP is not enabled for this recipient")
        if recipient.otp_verified:
            return

        if not recipient.otp_code or not recipient.otp_expires_at:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No OTP has been sent")
        
        expires_naive = recipient.otp_expires_at.replace(tzinfo=None) if recipient.otp_expires_at.tzinfo else recipient.otp_expires_at
        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        if now_naive > expires_naive:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP code has expired. Please request a new one.")
        if recipient.otp_code != code.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OTP code. Please try again.")

        recipient.otp_verified = True
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="signer_otp_verified",
            event_message=f"OTP successfully verified for {recipient.email}.",
        )
        db.commit()

    def accept_consent(
        self,
        db: Session,
        *,
        raw_token: str,
        ip_address: str | None,
        user_agent: str | None,
    ) -> None:
        signing_token, document, recipient = self.load_session(db, raw_token=raw_token)
        if recipient.consent_accepted:
            return

        recipient.consent_accepted = True
        recipient.consent_accepted_at = datetime.now(timezone.utc)

        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="consent_accepted",
            event_message=f"{recipient.email} accepted UETA/ESIGN electronic consent.",
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.commit()


signing_service = SigningService()
