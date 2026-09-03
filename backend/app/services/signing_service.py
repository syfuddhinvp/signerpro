import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.hashing import sha256_bytes
from app.core.storage import storage
from app.core.ratelimit import OTP_LOCKOUT_SECONDS, OTP_MAX_ATTEMPTS
from app.models.document import Document
from app.models.enums import (
    DocumentStatus,
    FieldType,
    RecipientRole,
    RecipientStatus,
    SignatureType,
    WorkflowType,
    is_signing_role,
)
from app.models.field_attachment import FieldAttachment
from app.models.field import Field
from app.models.recipient import Recipient
from app.models.signature import Signature
from app.models.signing_token import SigningToken
from app.schemas.signer import (
    AttachmentUploadResponse,
    CompletionResponse,
    DeclineRequest,
    FieldValueRequest,
    ReassignRequest,
    ReassignResponse,
    SignatureRequest,
    SigningSessionResponse,
)
from app.services.audit_service import audit_service
from app.services.field_service import field_service
from app.services.email_service import signflow_email_service
from app.services.pdf_service import pdf_service
from app.services.token_service import token_service


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


#: Field types captured through the signature ceremony rather than as text.
SIGNATURE_CEREMONY_FIELD_TYPES = frozenset({FieldType.signature, FieldType.initials})

#: Extensions a signer may attach, with the magic-byte prefixes that must back
#: them up. Mirrors the rigor of the sender-side PDF upload: the declared
#: extension is never trusted on its own.
ATTACHMENT_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    ".pdf": (b"%PDF",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".webp": (b"RIFF",),
}

#: A stamp is a mark on the page — a seal, a chop, a company logo — so it is
#: image-only. A PDF cannot be drawn into the field, and accepting one would
#: mean a stamp that appears nowhere in the executed contract.
STAMP_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

ATTACHMENT_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def _hash_otp(recipient_id: str, code: str) -> str:
    """Salted hash of an OTP code; only the digest is persisted."""
    return sha256_bytes(f"{recipient_id}:{code.strip()}".encode("utf-8"))


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
        read_only = (
            recipient.status == RecipientStatus.completed
            or document.status == DocumentStatus.completed
            # RTE-3: a `copy` recipient is a CC. Their link is a view link.
            or not is_signing_role(recipient.role)
        )
        otp_required = recipient.otp_enabled and not recipient.otp_verified and not read_only
        consent_required = not recipient.consent_accepted and not read_only

        own_fields = [field for field in document.fields if field.recipient_id == recipient.id]
        required_fields = self._outstanding_required_fields(document, recipient)
        completed = sum(1 for field in required_fields if self._field_has_value(field))

        # SIGN-1: a signing session must never carry another recipient's field
        # payload. ``fields`` is now strictly this recipient's own fields;
        # everybody else's placements are exposed separately, redacted down to
        # geometry so the sheet can still be laid out correctly (see
        # ``FieldPlacementResponse``). The old response returned
        # ``document.fields`` — labels and captured values included — and relied
        # on the client to filter, which is not a control at all.
        gate_open = not otp_required and not consent_required
        fields = own_fields if gate_open else []
        other_placements = (
            [field for field in document.fields if field.recipient_id != recipient.id] if gate_open else []
        )
        pdf_url = f"/api/sign/{raw_token}/pdf" if gate_open else ""

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
                "role": recipient.role,
                "status": recipient.status,
            },
            current_recipient_id=recipient.id,
            fields=fields,
            other_field_placements=other_placements,
            read_only=read_only,
            expires_at=signing_token.expires_at,
            pdf_url=pdf_url,
            required_total=len(required_fields),
            required_completed=completed,
            otp_required=otp_required,
            consent_required=consent_required,
            document_id=document.id,
            assigned_field_ids=[field.id for field in own_fields],
            consent_accepted=bool(recipient.consent_accepted),
            consent_accepted_at=recipient.consent_accepted_at,
            # A CC recipient has nothing to decline or delegate — they were
            # never asked to act (RTE-3).
            can_decline=not read_only and is_signing_role(recipient.role),
            can_reassign=not read_only and is_signing_role(recipient.role),
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
        # ``notified`` is terminal for a CC: opening the copy must not walk it
        # back to ``viewed``.
        if recipient.status not in {
            RecipientStatus.completed,
            RecipientStatus.notified,
            RecipientStatus.viewed,
        }:
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
            from app.services.crm_service import crm_integration_service

            crm_integration_service.trigger_document_viewed(db, document=document, recipient=recipient)
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
        if field.type in SIGNATURE_CEREMONY_FIELD_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use the signature endpoint for signature and initials fields",
            )
        if field.type == FieldType.attachment:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Use the attachment endpoint for attachment fields",
            )
        if field.type == FieldType.checkbox:
            new_value = "true" if bool(payload.value) else "false"
        else:
            new_value = str(payload.value).strip()
        # FLD-2: authoring intent (read_only / validation / conditional rule) is
        # enforced server-side, not just in the builder UI.
        field_service.validate_value(document, field, new_value)
        field.value = new_value
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
        # FLD-5: initials are captured through the same ceremony as a
        # signature (drawn or typed) — the signing UI has always routed them
        # here, and rejecting them made a required initials field unfinishable.
        if field.type not in SIGNATURE_CEREMONY_FIELD_TYPES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field is not a signature or initials field")
        field_service.validate_value(document, field, payload.signature_text or recipient.name)
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

    async def save_attachment(
        self,
        db: Session,
        *,
        raw_token: str,
        field_id: str,
        upload,
        ip_address: str | None,
        user_agent: str | None,
    ) -> AttachmentUploadResponse:
        """Accept a signer's file for an ``attachment`` field (FLD-6).

        Validation deliberately mirrors the sender-side PDF upload
        (``document_service.upload_pdf``): allow-listed extension, magic-byte
        check so the extension is never trusted on its own, and a bounded
        ``limit + 1`` read so an oversized body cannot be buffered whole.
        """
        from pathlib import Path
        from uuid import uuid4

        _, document, recipient = self.load_session(db, raw_token=raw_token)
        self._ensure_can_edit(document, recipient)
        field = self._get_owned_field(document, recipient, field_id)
        if field.type not in {FieldType.attachment, FieldType.stamp}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field does not accept a file")
        if field.read_only:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' is read-only")
        if not field_service.condition_is_met(document, field):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field '{field.label}' is hidden by its conditional rule",
            )

        filename = Path(upload.filename or "attachment").name
        extension = Path(filename).suffix.lower()
        allowed = STAMP_EXTENSIONS if field.type == FieldType.stamp else set(ATTACHMENT_SIGNATURES)
        if extension not in allowed:
            noun = "stamp image" if field.type == FieldType.stamp else "attachment"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported {noun} type. Allowed: {', '.join(sorted(allowed))}",
            )
        settings = get_settings()
        content = await upload.read(settings.max_upload_bytes + 1)
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Attachment exceeds size limit"
            )
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment is empty")
        if not any(content.startswith(prefix) for prefix in ATTACHMENT_SIGNATURES[extension]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Attachment contents do not match its file extension",
            )

        digest = sha256_bytes(content)
        relative_path = f"documents/{document.id}/attachments/{field.id}/{uuid4().hex}{extension}"
        storage.write_bytes(relative_path, content)

        # Stored-file metadata lives in ``field_attachments``; ``fields.options``
        # is authoring configuration and never carries evidence. ``value`` stays
        # the human-readable filename so the PDF stamper keeps rendering
        # something sensible. Re-uploading replaces the previous row.
        db.execute(delete(FieldAttachment).where(FieldAttachment.field_id == field.id))
        db.add(
            FieldAttachment(
                field_id=field.id,
                document_id=document.id,
                recipient_id=recipient.id,
                file_path=relative_path,
                filename=filename,
                content_type=ATTACHMENT_CONTENT_TYPES[extension],
                size_bytes=len(content),
                sha256=digest,
            )
        )
        field.value = filename
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="field_completed",
            event_message=f"Attachment '{filename}' uploaded for field '{field.label}' by {recipient.email}.",
            ip_address=ip_address,
            user_agent=user_agent,
            metadata={"field_id": field.id, "sha256": digest, "size_bytes": len(content)},
        )
        db.commit()
        db.refresh(field)
        return AttachmentUploadResponse(
            field_id=field.id,
            filename=filename,
            content_type=ATTACHMENT_CONTENT_TYPES[extension],
            size_bytes=len(content),
            sha256=digest,
        )

    def attachment_file(self, db: Session, *, raw_token: str, field_id: str) -> FieldAttachment:
        """The file this signer uploaded into one of their own fields.

        The sender already had ``GET /api/documents/{id}/fields/{fid}/attachment``;
        without the mirror of it the signer could upload a stamp and never see
        it again — a reload showed an empty box and no way to tell whether the
        upload had landed.
        """

        _, document, recipient = self.load_session(db, raw_token=raw_token)
        field = self._get_owned_field(document, recipient, field_id)
        attachment = db.scalar(
            select(FieldAttachment)
            .where(FieldAttachment.field_id == field.id)
            .order_by(FieldAttachment.created_at.desc())
        )
        if attachment is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nothing has been uploaded for this field")
        return attachment

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
        # FLD-3: a field whose conditional rule is unmet is *hidden*, and
        # ``field_service.validate_value`` refuses writes to it. Counting it as
        # outstanding here is what deadlocked the canonical conditional
        # envelope: unwritable and yet required. Both services now evaluate the
        # rule through ``field_service.condition_is_met``, so they can never
        # disagree again.
        outstanding = self._outstanding_required_fields(document, recipient)
        missing = [field.label for field in outstanding if not self._field_has_value(field)]
        if missing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Required fields are incomplete: {', '.join(missing)}")
        # A value captured before the controlling answer changed would still
        # be stamped into the executed PDF even though the field is hidden.
        # Hidden means "not part of the record", so it is dropped here.
        for field in document.fields:
            if field.recipient_id != recipient.id:
                continue
            if not field_service.condition_is_met(document, field) and field.value:
                field.value = None

        recipient.status = RecipientStatus.completed
        recipient.completed_at = datetime.now(timezone.utc)
        signing_token.used_at = recipient.completed_at
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="recipient_approved" if recipient.role == RecipientRole.approve else "recipient_completed",
            event_message=(
                f"{recipient.email} approved the document."
                if recipient.role == RecipientRole.approve
                else f"{recipient.email} completed signing."
            ),
            ip_address=ip_address,
            user_agent=user_agent,
        )

        from app.services.crm_service import crm_integration_service
        from app.models.usage_event import UsageEventType
        from app.services.entitlement_service import entitlement_service

        entitlement_service.record_usage(
            db,
            organization_id=document.organization_id,
            event_type=UsageEventType.recipient_signed,
            document_id=document.id,
        )
        crm_integration_service.trigger_signer_completed(db, document=document, recipient=recipient)

        # RTE-3: only recipients carrying a signing obligation gate execution.
        # A CC ("copy") recipient never completes, and used to hold the
        # envelope open forever.
        obligated = [item for item in document.recipients if is_signing_role(item.role)]
        if all(item.status == RecipientStatus.completed for item in obligated):
            # A CC recipient has no obligation to discharge: they reach the
            # terminal ``notified`` state, which does not claim they signed and
            # does not hold the completion gate open (the gate keys off signing
            # roles, not off every row having a ``completed_at``).
            for cc in document.recipients:
                if not is_signing_role(cc.role) and cc.status not in {
                    RecipientStatus.notified,
                    RecipientStatus.completed,
                    RecipientStatus.declined,
                }:
                    cc.status = RecipientStatus.notified
                    audit_service.log(
                        db,
                        document_id=document.id,
                        recipient_id=cc.id,
                        event_type="recipient_copy_delivered",
                        event_message=f"{cc.email} received a copy (no signature required).",
                    )
            db.flush()
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
        from app.services.crm_service import crm_integration_service

        crm_integration_service.trigger_document_declined(db, document=document, recipient=recipient)
        db.commit()

    def reassign(
        self,
        db: Session,
        *,
        raw_token: str,
        payload: ReassignRequest,
        ip_address: str | None,
        user_agent: str | None,
    ) -> ReassignResponse:
        """Delegate this signing turn to somebody else (SIGN-4).

        The caller's link is revoked, the recipient row is re-pointed at the
        delegate (so their field assignments carry over) and a fresh link is
        issued and emailed. Both addresses land in the audit trail.
        """
        signing_token, document, recipient = self.load_session(db, raw_token=raw_token)
        if document.status == DocumentStatus.completed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed documents cannot be reassigned")
        if recipient.status == RecipientStatus.completed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Recipient has already completed signing")
        new_email = str(payload.email).strip().lower()
        if new_email == recipient.email.strip().lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Delegate must be a different signer")
        if any(item.email.strip().lower() == new_email for item in document.recipients if item.id != recipient.id):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That signer is already on this document")

        previous_email = recipient.email
        signing_token.revoked_at = datetime.now(timezone.utc)
        recipient.name = payload.name.strip()
        recipient.email = new_email
        recipient.status = RecipientStatus.sent
        recipient.viewed_at = None
        # Identity changed: verification and consent must be re-established.
        recipient.otp_verified = False
        recipient.otp_code_hash = None
        recipient.otp_expires_at = None
        recipient.otp_attempts = 0
        recipient.otp_locked_until = None
        recipient.consent_accepted = False
        recipient.consent_accepted_at = None

        new_raw_token, _ = token_service.create_for_recipient(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            expires_at=document.expires_at,
        )
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="recipient_reassigned",
            event_message=f"{previous_email} reassigned signing to {new_email}.",
            ip_address=ip_address,
            user_agent=user_agent,
            metadata={"previous_email": previous_email, "new_email": new_email, "reason": payload.reason},
        )
        db.commit()
        signflow_email_service.send_signing_link(document=document, recipient=recipient, token=new_raw_token, db=db)
        return ReassignResponse(
            recipient_id=recipient.id,
            previous_email=previous_email,
            new_email=new_email,
            signing_url=f"{get_settings().app_base_url.rstrip('/')}/sign/{new_raw_token}",
        )

    def _activate_next_sequential_group(self, db: Session, document: Document) -> None:
        if document.workflow_type != WorkflowType.sequential:
            return
        # CC recipients are outside the sequence entirely: they are notified on
        # send and never hold a turn (RTE-3).
        signers = [item for item in document.recipients if is_signing_role(item.role)]
        waiting_orders = sorted({item.signing_order for item in signers if item.status == RecipientStatus.waiting})
        if not waiting_orders:
            return
        next_order = waiting_orders[0]
        lower_order_recipients = [item for item in signers if item.signing_order < next_order]
        if any(recipient.status != RecipientStatus.completed for recipient in lower_order_recipients):
            return
        for next_recipient in [item for item in signers if item.signing_order == next_order]:
            next_recipient.status = RecipientStatus.sent
            raw_token, _ = token_service.create_for_recipient(
                db,
                document_id=document.id,
                recipient_id=next_recipient.id,
                expires_at=document.expires_at,
            )
            signflow_email_service.send_signing_link(document=document, recipient=next_recipient, token=raw_token, db=db)
            audit_service.log(
                db,
                document_id=document.id,
                recipient_id=next_recipient.id,
                event_type="signer_email_sent",
                event_message=f"Sequential signing link sent to {next_recipient.email}.",
            )

    def _ensure_can_edit(self, document: Document, recipient: Recipient) -> None:
        if not is_signing_role(recipient.role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This recipient receives a copy only and cannot sign",
            )
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

    def _outstanding_required_fields(self, document: Document, recipient: Recipient) -> list[Field]:
        """This recipient's required fields that are actually answerable.

        A field is skipped when its conditional rule is unmet — the signer is
        forbidden from writing to it, so it cannot be part of what they owe.
        """
        return [
            field
            for field in document.fields
            if field.recipient_id == recipient.id
            and field.required
            and field_service.condition_is_met(document, field)
        ]

    def _field_has_value(self, field: Field) -> bool:
        if field.type == FieldType.checkbox:
            return str(field.value).lower() == "true"
        return bool(field.value and str(field.value).strip())

    def _ensure_otp_not_locked(self, recipient: Recipient) -> None:
        if recipient.otp_locked_until is None:
            return
        locked_until = _as_aware_utc(recipient.otp_locked_until)
        now = datetime.now(timezone.utc)
        if locked_until > now:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Verification is temporarily locked after too many failed attempts. Please try again later.",
                headers={"Retry-After": str(max(1, int((locked_until - now).total_seconds())))},
            )
        recipient.otp_locked_until = None
        recipient.otp_attempts = 0

    def send_otp(self, db: Session, *, raw_token: str) -> None:
        signing_token, document, recipient = self.load_session(db, raw_token=raw_token)
        if recipient.status == RecipientStatus.completed or document.status == DocumentStatus.completed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot send OTP for completed sessions")
        self._ensure_otp_not_locked(recipient)

        otp_code = "".join(secrets.choice("0123456789") for _ in range(6))
        recipient.otp_code_hash = _hash_otp(recipient.id, otp_code)
        recipient.otp_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        # A newly issued code resets the attempt counter, but never clears an
        # active lockout (a resend must not be a way out of a lockout).
        recipient.otp_attempts = 0

        # Load organization settings for gateway dispatch
        from app.models.organization import Organization
        org = db.get(Organization, document.organization_id)

        # Dispatch via SMS if phone is available, otherwise fall back to Email dispatch
        from app.models.plan import ENTITLEMENT_MAX_SMS_PER_MONTH
        from app.models.usage_event import UsageEventType
        from app.services.entitlement_service import entitlement_service

        # An exhausted SMS allowance (BIL-11) must not strand a signer
        # mid-session, so the code degrades to email rather than 402-ing.
        sms_allowed = recipient.phone_number and entitlement_service.has_headroom(
            db, document.organization_id, ENTITLEMENT_MAX_SMS_PER_MONTH, 1
        )
        if sms_allowed:
            from app.services.sms_service import sms_service
            sms_service.send_sms(
                to_phone=recipient.phone_number,
                body=f"Your SignFlow CRM document verification code is: {otp_code}. Valid for 10 minutes.",
                organization=org
            )
            entitlement_service.record_usage(
                db,
                organization_id=document.organization_id,
                event_type=UsageEventType.sms_sent,
                document_id=document.id,
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

        self._ensure_otp_not_locked(recipient)

        if not recipient.otp_code_hash or not recipient.otp_expires_at:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No OTP has been sent")

        if datetime.now(timezone.utc) > _as_aware_utc(recipient.otp_expires_at):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP code has expired. Please request a new one.")

        if not secrets.compare_digest(recipient.otp_code_hash, _hash_otp(recipient.id, code)):
            recipient.otp_attempts = (recipient.otp_attempts or 0) + 1
            remaining = OTP_MAX_ATTEMPTS - recipient.otp_attempts
            if remaining <= 0:
                recipient.otp_locked_until = datetime.now(timezone.utc) + timedelta(seconds=OTP_LOCKOUT_SECONDS)
                recipient.otp_code_hash = None
                audit_service.log(
                    db,
                    document_id=document.id,
                    recipient_id=recipient.id,
                    event_type="signer_otp_locked",
                    event_message=f"OTP verification locked for {recipient.email} after {OTP_MAX_ATTEMPTS} failed attempts.",
                )
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many incorrect verification codes. Verification is locked, please try again later.",
                    headers={"Retry-After": str(OTP_LOCKOUT_SECONDS)},
                )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid OTP code. Please try again. {remaining} attempt(s) remaining.",
            )

        recipient.otp_attempts = 0
        recipient.otp_locked_until = None
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
