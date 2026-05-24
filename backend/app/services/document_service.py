from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Iterable

from fastapi import HTTPException, UploadFile, status
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.hashing import sha256_bytes, sha256_json
from app.core.storage import storage
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.enums import DocumentStatus, DocumentVersionType, FieldType, RecipientStatus, WorkflowType
from app.models.field import Field
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.document import DocumentCreate, DocumentResponse, DocumentUpdate, SendDocumentResponse
from app.services.audit_service import audit_service
from app.services.email_service import signflow_email_service
from app.services.token_service import token_service


EDITABLE_STATUSES = {DocumentStatus.draft, DocumentStatus.prepared}


def document_response(document: Document) -> DocumentResponse:
    recipients = list(document.recipients or [])
    completed = sum(1 for recipient in recipients if recipient.status == RecipientStatus.completed)
    response = DocumentResponse.model_validate(document)
    response.recipients_total = len(recipients)
    response.recipients_completed = completed
    return response


class DocumentService:
    def get_for_user(self, db: Session, *, document_id: str, user: User) -> Document:
        document = db.get(Document, document_id)
        if not document or document.organization_id != user.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        return document

    def create(self, db: Session, *, user: User, payload: DocumentCreate) -> Document:
        document = Document(
            organization_id=user.organization_id,
            sender_id=user.id,
            title=payload.title,
            workflow_type=payload.workflow_type,
            is_template=payload.is_template,
        )
        db.add(document)
        db.flush()
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_created",
            event_message=f"Document '{document.title}' was created.",
        )
        db.commit()
        db.refresh(document)
        return document

    def list_for_user(self, db: Session, *, user: User, status_filter: DocumentStatus | None = None) -> list[Document]:
        query = select(Document).where(
            Document.organization_id == user.organization_id,
            Document.is_template == False
        ).order_by(Document.updated_at.desc())
        if status_filter:
            query = query.where(Document.status == status_filter)
        return list(db.scalars(query).unique())

    def list_templates(self, db: Session, *, user: User) -> list[Document]:
        query = select(Document).where(
            Document.organization_id == user.organization_id,
            Document.is_template == True
        ).order_by(Document.updated_at.desc())
        return list(db.scalars(query).unique())

    def use_template(self, db: Session, *, template_id: str, user: User) -> Document:
        template = self.get_for_user(db, document_id=template_id, user=user)
        if not template.is_template:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected document is not a template")
            
        new_doc = Document(
            organization_id=user.organization_id,
            sender_id=user.id,
            title=f"{template.title} (Copy)",
            status=DocumentStatus.draft,
            workflow_type=template.workflow_type,
            original_file_path=template.original_file_path,
            original_sha256=template.original_sha256,
            page_count=template.page_count,
            is_template=False
        )
        db.add(new_doc)
        db.flush()

        # Duplicate version info if available
        if template.original_file_path and template.original_sha256:
            db.add(
                DocumentVersion(
                    document_id=new_doc.id,
                    version_type=DocumentVersionType.original,
                    file_path=template.original_file_path,
                    sha256=template.original_sha256,
                )
            )
            new_doc.status = DocumentStatus.prepared
        
        recipient_map = {}
        for recip in template.recipients:
            new_recip = Recipient(
                document_id=new_doc.id,
                email=recip.email or "",
                name=recip.name or "",
                role_name=recip.role_name,
                signing_order=recip.signing_order,
                status=RecipientStatus.waiting
            )
            db.add(new_recip)
            db.flush()
            recipient_map[recip.id] = new_recip.id
            
        for field in template.fields:
            new_field = Field(
                document_id=new_doc.id,
                recipient_id=recipient_map.get(field.recipient_id),
                type=field.type,
                page_number=field.page_number,
                x=field.x,
                y=field.y,
                width=field.width,
                height=field.height,
                required=field.required,
                label=field.label,
                default_value=field.default_value
            )
            db.add(new_field)
            
        db.commit()
        db.refresh(new_doc)
        
        audit_service.log(
            db,
            document_id=new_doc.id,
            user_id=user.id,
            event_type="document_created",
            event_message=f"Created document from template '{template.title}'."
        )
        db.commit()
        return new_doc

    def update(self, db: Session, *, document: Document, user: User, payload: DocumentUpdate) -> Document:
        self.ensure_editable(document)
        if payload.title is not None:
            document.title = payload.title
        if payload.workflow_type is not None:
            document.workflow_type = payload.workflow_type
        if payload.is_template is not None:
            document.is_template = payload.is_template
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="field_updated",
            event_message="Document metadata was updated.",
        )
        db.commit()
        db.refresh(document)
        return document

    def delete(self, db: Session, *, document: Document) -> None:
        self.ensure_editable(document)
        db.delete(document)
        db.commit()

    def ensure_editable(self, document: Document) -> None:
        if document.status not in EDITABLE_STATUSES:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Document cannot be edited in its current status")

    async def upload_pdf(self, db: Session, *, document: Document, user: User, upload: UploadFile) -> Document:
        self.ensure_editable(document)
        if document.original_file_path:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Original PDF cannot be overwritten")
        filename = upload.filename or "document.pdf"
        if not filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only PDF files are supported")
        settings = get_settings()
        content = await upload.read(settings.max_upload_bytes + 1)
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="PDF exceeds size limit")
        if not content.startswith(b"%PDF"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is not a valid PDF")
        try:
            reader = PdfReader(BytesIO(content))
            page_count = len(reader.pages)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF could not be read") from exc
        if page_count < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF must contain at least one page")

        relative_path = f"documents/{document.id}/original.pdf"
        storage.write_bytes(relative_path, content)
        original_hash = sha256_bytes(content)
        document.original_file_path = relative_path
        document.original_sha256 = original_hash
        document.page_count = page_count
        document.status = DocumentStatus.prepared
        db.add(
            DocumentVersion(
                document_id=document.id,
                version_type=DocumentVersionType.original,
                file_path=relative_path,
                sha256=original_hash,
            )
        )
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_uploaded",
            event_message=f"Original PDF uploaded with {page_count} page(s).",
            metadata={"sha256": original_hash, "filename": filename},
        )
        db.commit()
        db.refresh(document)
        return document

    def validate_for_send(self, document: Document) -> None:
        if not document.original_file_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a PDF before sending")
        if not document.recipients:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Add at least one recipient before sending")
        if not document.fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Add at least one field before sending")
        for field in document.fields:
            self._validate_field_page_and_coords(document, field)
        for recipient in document.recipients:
            recipient_fields = [field for field in document.fields if field.recipient_id == recipient.id]
            has_required_or_signature = any(field.required or field.type == FieldType.signature for field in recipient_fields)
            if not has_required_or_signature:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Recipient {recipient.email} needs at least one required or signature field",
                )

    def _validate_field_page_and_coords(self, document: Document, field: Field) -> None:
        if field.page_number < 1 or field.page_number > document.page_count:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' has an invalid page")
        if min(field.x, field.y, field.width, field.height) < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' has invalid coordinates")
        if field.width == 0 or field.height == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' must have size")

    def send(
        self,
        db: Session,
        *,
        document: Document,
        user: User,
        ip_address: str | None,
        user_agent: str | None,
    ) -> SendDocumentResponse:
        if document.is_template:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Templates cannot be sent directly.")
        self.ensure_editable(document)
        self.validate_for_send(document)

        field_payload = [
            {
                "id": field.id,
                "recipient_id": field.recipient_id,
                "type": field.type,
                "page_number": field.page_number,
                "x": str(field.x),
                "y": str(field.y),
                "width": str(field.width),
                "height": str(field.height),
                "required": field.required,
                "label": field.label,
            }
            for field in sorted(document.fields, key=lambda item: item.id)
        ]
        document.field_config_sha256 = sha256_json(field_payload)
        document.status = DocumentStatus.sent
        document.sent_at = datetime.now(timezone.utc)
        document.expires_at = document.sent_at + timedelta(days=get_settings().signing_token_expire_days)

        recipients_to_email = self._recipients_available_to_sign(document.recipients, document.workflow_type)
        links: list[dict[str, str]] = []
        for recipient in document.recipients:
            recipient.status = RecipientStatus.waiting
        for recipient in recipients_to_email:
            recipient.status = RecipientStatus.sent
            raw_token, _ = token_service.create_for_recipient(db, document_id=document.id, recipient_id=recipient.id)
            link = signflow_email_service.send_signing_link(document=document, recipient=recipient, token=raw_token, db=db)
            links.append({"recipient_id": recipient.id, "email": recipient.email, "signing_link": link})
            audit_service.log(
                db,
                document_id=document.id,
                recipient_id=recipient.id,
                user_id=user.id,
                event_type="signer_email_sent",
                event_message=f"Signing link sent to {recipient.email}.",
            )

        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_sent",
            event_message="Document was sent for signature.",
            ip_address=ip_address,
            user_agent=user_agent,
            metadata={"workflow_type": document.workflow_type, "field_config_sha256": document.field_config_sha256},
        )
        db.commit()
        db.refresh(document)
        return SendDocumentResponse(document=document_response(document), signing_links=links)

    def _recipients_available_to_sign(self, recipients: Iterable[Recipient], workflow_type: WorkflowType) -> list[Recipient]:
        recipients = list(recipients)
        if workflow_type == WorkflowType.parallel:
            return recipients
        first_order = min(recipient.signing_order for recipient in recipients)
        return [recipient for recipient in recipients if recipient.signing_order == first_order]

    def void(self, db: Session, *, document: Document, user: User, reason: str | None = None) -> Document:
        if document.is_template:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Templates cannot be voided.")
        if document.status == DocumentStatus.completed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Completed documents cannot be voided")
        document.status = DocumentStatus.voided
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_voided",
            event_message="Document was voided.",
            metadata={"reason": reason},
        )
        db.commit()
        db.refresh(document)
        return document


document_service = DocumentService()
