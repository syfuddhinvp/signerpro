from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Iterable

from fastapi import HTTPException, UploadFile, status
from pypdf import PdfReader
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.hashing import sha256_bytes, sha256_json
from app.core.storage import storage
from app.models.document import Document
from app.models.document_favorite import DocumentFavorite
from app.models.folder import Folder
from app.models.document_version import DocumentVersion
from app.models.enums import (
    DocumentStatus,
    DocumentVersionType,
    FieldType,
    RecipientRole,
    RecipientStatus,
    WorkflowType,
    is_signing_role,
)
from app.models.field import Field
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.document import (
    DocumentCounts,
    DocumentCreate,
    DocumentResponse,
    DocumentUpdate,
    RoutingResponse,
    RoutingUpdate,
    SendDocumentResponse,
)
from app.services.audit_service import audit_service
from app.services.crm_service import crm_integration_service
from app.services.email_service import signflow_email_service
from app.services.token_service import token_service


#: Ceiling on the endpoints that expose no pagination parameters of their own
#: (``GET /api/documents``, ``GET /api/templates``). The paginated library
#: endpoint has its own ``limit``; this only stops the unbounded ones from
#: materialising an entire tenant's library into memory and into one JSON body.
LIST_HARD_LIMIT = 500

EDITABLE_STATUSES = {DocumentStatus.draft, DocumentStatus.prepared}
ACTIVE_STATUSES = {DocumentStatus.sent, DocumentStatus.viewed, DocumentStatus.partially_completed}


def _as_utc(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; treat those as UTC so the expiring
    comparison matches what the SQL `expires_at <= horizon` filter does."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


# ``document_response`` reads ``document.recipients`` for every row, so listing a
# library without this issues one lazy SELECT per document -- 201 queries for a
# 200-document page. ``selectinload`` fetches them all in a second query keyed by
# document id, making any list endpoint two queries regardless of page size.
# (``joinedload`` would work too, but it multiplies the parent rows by the
# recipient count and forces a de-duplicating pass over the whole result.)
_WITH_RECIPIENTS = selectinload(Document.recipients)


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
            owner_user_id=user.id,
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
        crm_integration_service.trigger_document_created(db, document=document)
        db.commit()
        db.refresh(document)
        return document

    def list_for_user(self, db: Session, *, user: User, status_filter: DocumentStatus | None = None) -> list[Document]:
        query = select(Document).options(_WITH_RECIPIENTS).where(
            Document.organization_id == user.organization_id,
            Document.is_template == False,
            Document.deleted_at.is_(None),
        ).order_by(Document.updated_at.desc())
        if status_filter:
            query = query.where(Document.status == status_filter)
        # Hard cap: this endpoint takes no pagination parameters, so without a
        # bound a large tenant can make the API allocate its whole library --
        # a denial of service against yourself. See LIST_HARD_LIMIT.
        return list(db.scalars(query.limit(LIST_HARD_LIMIT)).unique())

    def list_templates(self, db: Session, *, user: User) -> list[Document]:
        query = select(Document).options(_WITH_RECIPIENTS).where(
            Document.organization_id == user.organization_id,
            Document.is_template == True,
            Document.deleted_at.is_(None),
        ).order_by(Document.updated_at.desc())
        return list(db.scalars(query.limit(LIST_HARD_LIMIT)).unique())

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
            is_template=False,
            # Keeps TemplateResponse.use_count derivable without a stored counter.
            source_template_id=template.id,
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
        crm_integration_service.trigger_document_created(db, document=new_doc)
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
        if payload.doc_type is not None:
            document.doc_type = payload.doc_type
        if "folder_id" in payload.model_fields_set:
            self.move(db, document=document, user=user, folder_id=payload.folder_id)
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
            # RTE-3: only a recipient with a signing obligation must own
            # something to do. A `copy` recipient is a CC — requiring them to
            # hold a signature field is what forced counsel to sign a contract
            # they were only being sent for information. An `approve`
            # recipient signals approval by completing the envelope and does
            # not need a signature block either.
            if recipient.role in {RecipientRole.copy, RecipientRole.approve}:
                continue
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
        # The envelope's own setting wins (RTE-1); the global
        # SIGNING_TOKEN_EXPIRE_DAYS is only the fallback for rows that carry no
        # per-document value.
        expire_days = document.expires_in_days or get_settings().signing_token_expire_days
        document.expires_at = document.sent_at + timedelta(days=expire_days)

        recipients_to_email = self._recipients_available_to_sign(document.recipients, document.workflow_type)
        links: list[dict[str, str]] = []
        for recipient in document.recipients:
            recipient.status = RecipientStatus.waiting
        for recipient in recipients_to_email:
            recipient.status = RecipientStatus.sent
            raw_token, _ = token_service.create_for_recipient(
                db,
                document_id=document.id,
                recipient_id=recipient.id,
                expires_at=document.expires_at,
            )
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
        crm_integration_service.trigger_document_sent(db, document=document)
        db.commit()
        db.refresh(document)
        return SendDocumentResponse(document=document_response(document), signing_links=links)

    def _recipients_available_to_sign(self, recipients: Iterable[Recipient], workflow_type: WorkflowType) -> list[Recipient]:
        """Who receives a link at send time.

        RTE-3: CC (`copy`) recipients sit outside the routing sequence — they
        are notified immediately regardless of workflow, and their link is a
        read-only view link (``signing_service.session_response`` marks the
        session ``read_only``). Only signing roles take turns.
        """
        recipients = list(recipients)
        copies = [recipient for recipient in recipients if not is_signing_role(recipient.role)]
        signers = [recipient for recipient in recipients if is_signing_role(recipient.role)]
        if workflow_type == WorkflowType.parallel or not signers:
            return signers + copies
        first_order = min(recipient.signing_order for recipient in signers)
        return [recipient for recipient in signers if recipient.signing_order == first_order] + copies

    # ------------------------------------------------------------------
    # Library (DOC-1) and row actions (DOC-2…DOC-7)
    # ------------------------------------------------------------------

    def _library_base(self, user: User):
        return select(Document).options(_WITH_RECIPIENTS).where(
            Document.organization_id == user.organization_id,
            Document.is_template == False,  # noqa: E712
        )

    def _favorite_ids(self, db: Session, *, user: User) -> set[str]:
        return set(
            db.scalars(
                select(DocumentFavorite.document_id).where(DocumentFavorite.user_id == user.id)
            ).all()
        )

    def library_counts(self, db: Session, *, user: User) -> DocumentCounts:
        """Sidebar badge counts. `action` is what needs *this user* to sign;
        `waiting` is out for signature by anyone else.

        Every `quick` bucket the library supports gets a count here, derived
        with the same predicate `library()` applies for that bucket — one pass
        over the tenant's documents plus two id lookups, because this runs on
        every page load.
        """
        rows = list(
            db.execute(
                select(
                    Document.id,
                    Document.status,
                    Document.archived_at,
                    Document.deleted_at,
                    Document.is_template,
                    Document.sender_id,
                    Document.owner_user_id,
                    Document.expires_at,
                )
                .where(Document.organization_id == user.organization_id)
            ).all()
        )
        action_ids = set(
            db.scalars(
                select(Recipient.document_id)
                .join(Document, Document.id == Recipient.document_id)
                .where(
                    Document.organization_id == user.organization_id,
                    Recipient.email == (user.email or "").lower(),
                    Recipient.status.in_([RecipientStatus.sent, RecipientStatus.viewed]),
                )
            ).all()
        )
        favorites = self._favorite_ids(db, user=user)
        horizon = datetime.now(timezone.utc) + timedelta(days=7)
        counts = DocumentCounts()
        for (
            doc_id,
            doc_status,
            archived_at,
            deleted_at,
            is_template,
            sender_id,
            owner_user_id,
            expires_at,
        ) in rows:
            if deleted_at is not None:
                counts.trashed += 1
                continue
            if is_template:
                counts.templates += 1
                continue
            if archived_at is not None:
                counts.archived += 1
                continue
            counts.all += 1
            is_active = doc_status in ACTIVE_STATUSES
            if doc_status in {DocumentStatus.draft, DocumentStatus.prepared}:
                counts.draft += 1
            elif doc_status == DocumentStatus.completed:
                counts.completed += 1
            elif doc_status in {DocumentStatus.voided, DocumentStatus.declined, DocumentStatus.expired}:
                counts.voided += 1
            if is_active:
                counts.waiting += 1
            if doc_id in action_ids:
                counts.action += 1
            # quick buckets — same predicates as library(quick=...)
            if doc_id in action_ids:
                counts.inbox += 1
            if is_active:
                counts.outbox += 1
            if doc_status in {DocumentStatus.draft, DocumentStatus.prepared}:
                counts.drafts += 1
            if doc_id in favorites:
                counts.favorites += 1
            if is_active and expires_at is not None and _as_utc(expires_at) <= horizon:
                counts.expiring += 1
            if owner_user_id == user.id or sender_id == user.id:
                counts.mine += 1
            if sender_id != user.id and (owner_user_id is None or owner_user_id != user.id):
                counts.shared += 1
        return counts

    def library(
        self,
        db: Session,
        *,
        user: User,
        quick: str = "all",
        status_filter: DocumentStatus | None = None,
        doc_type: str | None = None,
        folder_id: str | None = None,
        owner: str | None = None,
        since_days: int | None = None,
        q: str | None = None,
        sort: str = "recent",
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[Document], int, set[str]]:
        query = self._library_base(user)
        favorites = self._favorite_ids(db, user=user)

        if quick == "trash":
            query = query.where(Document.deleted_at.is_not(None))
        elif quick == "archived":
            query = query.where(Document.deleted_at.is_(None), Document.archived_at.is_not(None))
        else:
            query = query.where(Document.deleted_at.is_(None), Document.archived_at.is_(None))

        if quick in {"drafts"}:
            query = query.where(Document.status.in_([DocumentStatus.draft, DocumentStatus.prepared]))
        elif quick == "completed":
            query = query.where(Document.status == DocumentStatus.completed)
        elif quick in {"outbox", "waiting"}:
            query = query.where(Document.status.in_(list(ACTIVE_STATUSES)))
        elif quick == "inbox":
            inbox = (
                select(Recipient.document_id)
                .where(
                    Recipient.email == (user.email or "").lower(),
                    Recipient.status.in_([RecipientStatus.sent, RecipientStatus.viewed]),
                )
                .scalar_subquery()
            )
            query = query.where(Document.id.in_(inbox))
        elif quick == "favorites":
            query = query.where(Document.id.in_(favorites or [""]))
        elif quick == "expiring":
            horizon = datetime.now(timezone.utc) + timedelta(days=7)
            query = query.where(
                Document.status.in_(list(ACTIVE_STATUSES)),
                Document.expires_at.is_not(None),
                Document.expires_at <= horizon,
            )
        elif quick == "mine":
            query = query.where(
                or_(Document.owner_user_id == user.id, Document.sender_id == user.id)
            )
        elif quick == "shared":
            query = query.where(
                Document.sender_id != user.id,
                or_(Document.owner_user_id.is_(None), Document.owner_user_id != user.id),
            )

        if status_filter:
            query = query.where(Document.status == status_filter)
        if doc_type:
            query = query.where(Document.doc_type == doc_type)
        if folder_id:
            query = query.where(Document.folder_id == folder_id)
        if owner == "me":
            query = query.where(or_(Document.owner_user_id == user.id, Document.sender_id == user.id))
        elif owner == "shared":
            query = query.where(Document.sender_id != user.id)
        elif owner and owner != "team":
            query = query.where(or_(Document.owner_user_id == owner, Document.sender_id == owner))
        if since_days:
            query = query.where(Document.updated_at >= datetime.now(timezone.utc) - timedelta(days=since_days))
        if q:
            needle = f"%{q.strip().lower()}%"
            recipient_match = (
                select(Recipient.document_id)
                .where(or_(func.lower(Recipient.email).like(needle), func.lower(Recipient.name).like(needle)))
                .scalar_subquery()
            )
            query = query.where(or_(func.lower(Document.title).like(needle), Document.id.in_(recipient_match)))

        total = db.scalar(select(func.count()).select_from(query.subquery())) or 0

        if sort == "name":
            query = query.order_by(func.lower(Document.title).asc())
        elif sort == "status":
            query = query.order_by(Document.status.asc(), Document.updated_at.desc())
        elif sort == "owner":
            query = query.order_by(Document.sender_id.asc(), Document.updated_at.desc())
        else:
            query = query.order_by(Document.updated_at.desc())

        items = list(db.scalars(query.limit(limit).offset(offset)).unique())
        return items, total, favorites

    def owner_names(self, db: Session, documents: Iterable[Document]) -> dict[str, str]:
        documents = list(documents)
        ids = {doc.owner_user_id or doc.sender_id for doc in documents}
        ids.discard(None)
        if not ids:
            return {}
        return {
            user_id: name
            for user_id, name in db.execute(select(User.id, User.name).where(User.id.in_(ids))).all()
        }

    def rename(self, db: Session, *, document: Document, user: User, title: str) -> Document:
        previous = document.title
        document.title = title
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_renamed",
            event_message=f"Document renamed from '{previous}' to '{title}'.",
        )
        db.commit()
        db.refresh(document)
        return document

    def duplicate(self, db: Session, *, document: Document, user: User, title: str | None = None, as_template: bool = False) -> Document:
        copy = Document(
            organization_id=document.organization_id,
            sender_id=user.id,
            owner_user_id=user.id,
            title=title or f"{document.title} (Copy)",
            status=DocumentStatus.prepared if document.original_file_path else DocumentStatus.draft,
            workflow_type=document.workflow_type,
            original_file_path=document.original_file_path,
            original_sha256=document.original_sha256,
            page_count=document.page_count,
            is_template=as_template,
            folder_id=document.folder_id,
            doc_type=document.doc_type,
            source_template_id=document.id if document.is_template else document.source_template_id,
            reminder_cadence=document.reminder_cadence,
            expires_in_days=document.expires_in_days,
            invite_subject=document.invite_subject,
            invite_message=document.invite_message,
        )
        db.add(copy)
        db.flush()
        if document.original_file_path and document.original_sha256:
            db.add(
                DocumentVersion(
                    document_id=copy.id,
                    version_type=DocumentVersionType.original,
                    file_path=document.original_file_path,
                    sha256=document.original_sha256,
                )
            )
        recipient_map: dict[str, str] = {}
        for recipient in document.recipients:
            clone = Recipient(
                document_id=copy.id,
                name=recipient.name,
                email=recipient.email,
                role_name=recipient.role_name,
                role=recipient.role,
                color=recipient.color,
                contact_id=recipient.contact_id,
                signing_order=recipient.signing_order,
                status=RecipientStatus.waiting,
                otp_enabled=recipient.otp_enabled,
                phone_number=recipient.phone_number,
            )
            db.add(clone)
            db.flush()
            recipient_map[recipient.id] = clone.id
        for field in document.fields:
            db.add(
                Field(
                    document_id=copy.id,
                    recipient_id=recipient_map.get(field.recipient_id),
                    type=field.type,
                    label=field.label,
                    required=field.required,
                    page_number=field.page_number,
                    x=field.x,
                    y=field.y,
                    width=field.width,
                    height=field.height,
                    placeholder=field.placeholder,
                    default_value=field.default_value,
                    options=field.options,
                    validation=field.validation,
                    validation_pattern=field.validation_pattern,
                    condition=field.condition,
                    merge_tag=field.merge_tag,
                    read_only=field.read_only,
                )
            )
        audit_service.log(
            db,
            document_id=copy.id,
            user_id=user.id,
            event_type="document_created",
            event_message=(
                f"Template created from '{document.title}'." if as_template else f"Document duplicated from '{document.title}'."
            ),
            metadata={"source_document_id": document.id},
        )
        # `trigger_document_created` filters templates itself, so a
        # "duplicate as template" produces no envelope event.
        crm_integration_service.trigger_document_created(db, document=copy)
        db.commit()
        db.refresh(copy)
        return copy

    def set_archived(self, db: Session, *, document: Document, user: User, archived: bool) -> Document:
        document.archived_at = datetime.now(timezone.utc) if archived else None
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_archived" if archived else "document_unarchived",
            event_message=f"Document was {'archived' if archived else 'restored from the archive'}.",
        )
        db.commit()
        db.refresh(document)
        return document

    def soft_delete(self, db: Session, *, document: Document, user: User) -> Document:
        document.deleted_at = datetime.now(timezone.utc)
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_trashed",
            event_message="Document was moved to the trash.",
        )
        db.commit()
        db.refresh(document)
        return document

    def restore(self, db: Session, *, document: Document, user: User) -> Document:
        if document.deleted_at is None and document.archived_at is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Document is not archived or trashed")
        document.deleted_at = None
        document.archived_at = None
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_restored",
            event_message="Document was restored.",
        )
        db.commit()
        db.refresh(document)
        return document

    def purge(self, db: Session, *, document: Document) -> None:
        if document.deleted_at is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only trashed documents can be purged")
        # RETENTION (C6): the audit trail is evidence and is NOT purged with the
        # document. ESIGN/UETA and eIDAS require it to be retained independently
        # of the signed artefact. detach_document() records the purge as a final
        # chain entry and severs the FK; the rows keep their denormalized
        # document_ref/title/organization_id so the trail stays meaningful.
        audit_service.detach_document(db, document)
        db.delete(document)
        db.commit()

    def empty_trash(self, db: Session, *, user: User) -> int:
        documents = list(
            db.scalars(
                select(Document).where(
                    Document.organization_id == user.organization_id,
                    Document.deleted_at.is_not(None),
                )
            ).unique()
        )
        for document in documents:
            # Audit trails are retained; see purge() above.
            audit_service.detach_document(db, document)
            db.delete(document)
        db.commit()
        return len(documents)

    def move(self, db: Session, *, document: Document, user: User, folder_id: str | None) -> Document:
        if folder_id is not None:
            folder = db.get(Folder, folder_id)
            if not folder or folder.organization_id != user.organization_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
        document.folder_id = folder_id
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_moved",
            event_message="Document was moved to a different folder.",
            metadata={"folder_id": folder_id},
        )
        db.commit()
        db.refresh(document)
        return document

    def set_favorite(self, db: Session, *, document: Document, user: User, favorite: bool) -> None:
        existing = db.scalars(
            select(DocumentFavorite).where(
                DocumentFavorite.user_id == user.id, DocumentFavorite.document_id == document.id
            )
        ).first()
        if favorite and not existing:
            db.add(DocumentFavorite(user_id=user.id, document_id=document.id))
        elif not favorite and existing:
            db.delete(existing)
        db.commit()

    def bulk_action(
        self, db: Session, *, user: User, document_ids: list[str], action: str, folder_id: str | None = None
    ) -> tuple[int, list[str], list[dict[str, str]]]:
        updated: list[str] = []
        skipped: list[dict[str, str]] = []
        for document_id in dict.fromkeys(document_ids):
            document = db.get(Document, document_id)
            if not document or document.organization_id != user.organization_id:
                skipped.append({"document_id": document_id, "reason": "not_found"})
                continue
            try:
                if action == "archive":
                    self.set_archived(db, document=document, user=user, archived=True)
                elif action in {"restore", "unarchive"}:
                    if action == "unarchive":
                        self.set_archived(db, document=document, user=user, archived=False)
                    else:
                        self.restore(db, document=document, user=user)
                elif action == "delete":
                    self.soft_delete(db, document=document, user=user)
                elif action == "purge":
                    self.purge(db, document=document)
                elif action == "move":
                    self.move(db, document=document, user=user, folder_id=folder_id)
                else:  # pragma: no cover - guarded by the schema Literal
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported bulk action")
            except HTTPException as exc:
                db.rollback()
                skipped.append({"document_id": document_id, "reason": str(exc.detail)})
                continue
            updated.append(document_id)
        return len(updated), updated, skipped

    # ------------------------------------------------------------------
    # Routing settings (RTE-1)
    # ------------------------------------------------------------------

    def routing(self, document: Document) -> RoutingResponse:
        return RoutingResponse(
            document_id=document.id,
            workflow_type=document.workflow_type,
            reminder_cadence=document.reminder_cadence,
            expires_in_days=document.expires_in_days,
            invite_subject=document.invite_subject,
            invite_message=document.invite_message,
        )

    def update_routing(self, db: Session, *, document: Document, user: User, payload: RoutingUpdate) -> RoutingResponse:
        self.ensure_editable(document)
        updates = payload.model_dump(exclude_unset=True)
        for key, value in updates.items():
            setattr(document, key, value)
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="routing_updated",
            event_message="Routing settings were updated.",
            metadata={key: str(value) for key, value in updates.items()},
        )
        db.commit()
        db.refresh(document)
        return self.routing(document)

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
        crm_integration_service.trigger_document_voided(db, document=document, reason=reason)
        db.commit()
        db.refresh(document)
        return document


document_service = DocumentService()
