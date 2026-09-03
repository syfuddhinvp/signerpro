from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.enums import DocumentStatus, DocumentVersionType, RecipientStatus
from app.models.field import Field
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.template import (
    TemplateResponse,
    TemplateUpdate,
    TemplateUsageResponse,
    TemplateUsageSender,
)
from app.services.audit_service import audit_service
from app.services.crm_service import crm_integration_service
from app.services.folder_service import folder_service


SORTABLE = {"recent", "name", "uses"}


class TemplateService:
    # ---------- lookup ----------

    def get_for_user(self, db: Session, *, template_id: str, user: User) -> Document:
        template = db.get(Document, template_id)
        if not template or template.organization_id != user.organization_id or not template.is_template:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
        return template

    def _use_counts(self, db: Session, *, organization_id: str) -> dict[str, int]:
        rows = db.execute(
            select(Document.source_template_id, func.count(Document.id))
            .where(
                Document.organization_id == organization_id,
                Document.source_template_id.is_not(None),
            )
            .group_by(Document.source_template_id)
        ).all()
        return {row[0]: row[1] for row in rows}

    def _child_counts(self, db: Session, template_ids: list[str]) -> tuple[dict[str, int], dict[str, int]]:
        if not template_ids:
            return {}, {}
        field_rows = db.execute(
            select(Field.document_id, func.count(Field.id))
            .where(Field.document_id.in_(template_ids))
            .group_by(Field.document_id)
        ).all()
        recipient_rows = db.execute(
            select(Recipient.document_id, func.count(Recipient.id))
            .where(Recipient.document_id.in_(template_ids))
            .group_by(Recipient.document_id)
        ).all()
        return {row[0]: row[1] for row in field_rows}, {row[0]: row[1] for row in recipient_rows}

    def _owner_names(self, db: Session, templates: list[Document]) -> dict[str, str]:
        user_ids = {t.owner_user_id or t.sender_id for t in templates if (t.owner_user_id or t.sender_id)}
        if not user_ids:
            return {}
        rows = db.scalars(select(User).where(User.id.in_(user_ids))).unique()
        return {row.id: row.name for row in rows}

    def responses(self, db: Session, templates: list[Document], *, organization_id: str) -> list[TemplateResponse]:
        uses = self._use_counts(db, organization_id=organization_id)
        field_counts, recipient_counts = self._child_counts(db, [t.id for t in templates])
        owner_names = self._owner_names(db, templates)
        out: list[TemplateResponse] = []
        for template in templates:
            owner_id = template.owner_user_id or template.sender_id
            out.append(
                TemplateResponse(
                    id=template.id,
                    organization_id=template.organization_id,
                    title=template.title,
                    doc_type=template.doc_type,
                    workflow_type=template.workflow_type,
                    use_count=uses.get(template.id, 0),
                    field_count=field_counts.get(template.id, 0),
                    recipient_count=recipient_counts.get(template.id, 0),
                    owner_user_id=template.owner_user_id,
                    owner_name=owner_names.get(owner_id),
                    folder_id=template.folder_id,
                    page_count=template.page_count,
                    archived_at=template.archived_at,
                    created_at=template.created_at,
                    updated_at=template.updated_at,
                )
            )
        return out

    def single_response(self, db: Session, template: Document) -> TemplateResponse:
        return self.responses(db, [template], organization_id=template.organization_id)[0]

    # ---------- list ----------

    def list_for_user(
        self,
        db: Session,
        *,
        user: User,
        q: str | None = None,
        owner: str | None = None,
        sort: str = "recent",
        include_archived: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[TemplateResponse], int]:
        if sort not in SORTABLE:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"sort must be one of {sorted(SORTABLE)}")
        # selectinload: the response mapper reads ``recipients`` per row, which
        # is one lazy SELECT per template without it.
        query = select(Document).options(selectinload(Document.recipients)).where(
            Document.organization_id == user.organization_id,
            Document.is_template == True,  # noqa: E712
            Document.deleted_at.is_(None),
        )
        if not include_archived:
            query = query.where(Document.archived_at.is_(None))
        if q:
            query = query.where(func.lower(Document.title).like(f"%{q.lower()}%"))
        if owner == "me":
            query = query.where(or_(Document.owner_user_id == user.id, Document.sender_id == user.id))
        templates = list(db.scalars(query).unique())
        responses = self.responses(db, templates, organization_id=user.organization_id)
        if sort == "name":
            responses.sort(key=lambda item: item.title.lower())
        elif sort == "uses":
            responses.sort(key=lambda item: item.use_count, reverse=True)
        else:
            responses.sort(key=lambda item: item.updated_at, reverse=True)
        return responses[offset : offset + limit], len(responses)

    # ---------- mutations ----------

    def update(self, db: Session, *, template: Document, user: User, payload: TemplateUpdate) -> Document:
        data = payload.model_dump(exclude_unset=True)
        if "folder_id" in data and data["folder_id"]:
            folder_service.get_for_user(db, folder_id=data["folder_id"], user=user)
        for key, value in data.items():
            setattr(template, key, value)
        audit_service.log(
            db,
            document_id=template.id,
            user_id=user.id,
            event_type="field_updated",
            event_message="Template metadata was updated.",
        )
        db.commit()
        db.refresh(template)
        return template

    def archive(self, db: Session, *, template: Document, archived: bool) -> Document:
        template.archived_at = datetime.now(timezone.utc) if archived else None
        db.commit()
        db.refresh(template)
        return template

    def _copy(
        self,
        db: Session,
        *,
        source: Document,
        user: User,
        title: str,
        is_template: bool,
        folder_id: str | None,
        source_template_id: str | None,
    ) -> Document:
        copy = Document(
            organization_id=user.organization_id,
            sender_id=user.id,
            owner_user_id=user.id,
            title=title,
            status=DocumentStatus.draft,
            workflow_type=source.workflow_type,
            original_file_path=source.original_file_path,
            original_sha256=source.original_sha256,
            page_count=source.page_count,
            is_template=is_template,
            doc_type=source.doc_type,
            folder_id=folder_id,
            source_template_id=source_template_id,
            reminder_cadence=source.reminder_cadence,
            expires_in_days=source.expires_in_days,
            invite_subject=source.invite_subject,
            invite_message=source.invite_message,
        )
        db.add(copy)
        db.flush()

        if source.original_file_path and source.original_sha256:
            db.add(
                DocumentVersion(
                    document_id=copy.id,
                    version_type=DocumentVersionType.original,
                    file_path=source.original_file_path,
                    sha256=source.original_sha256,
                )
            )
            copy.status = DocumentStatus.prepared

        recipient_map: dict[str, str] = {}
        for recipient in source.recipients or []:
            new_recipient = Recipient(
                document_id=copy.id,
                name=recipient.name or "",
                email=recipient.email or "",
                role_name=recipient.role_name,
                role=recipient.role,
                color=recipient.color,
                contact_id=recipient.contact_id,
                signing_order=recipient.signing_order,
                status=RecipientStatus.waiting,
                otp_enabled=recipient.otp_enabled,
                phone_number=recipient.phone_number,
            )
            db.add(new_recipient)
            db.flush()
            recipient_map[recipient.id] = new_recipient.id

        for field in source.fields or []:
            db.add(
                Field(
                    document_id=copy.id,
                    recipient_id=recipient_map.get(field.recipient_id),
                    type=field.type,
                    page_number=field.page_number,
                    x=field.x,
                    y=field.y,
                    width=field.width,
                    height=field.height,
                    required=field.required,
                    label=field.label,
                    default_value=field.default_value,
                )
            )
        db.flush()
        return copy

    def create_from_document(self, db: Session, *, document: Document, user: User, title: str | None, folder_id: str | None) -> Document:
        if document.is_template:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document is already a template")
        if folder_id:
            folder_service.get_for_user(db, folder_id=folder_id, user=user)
        template = self._copy(
            db,
            source=document,
            user=user,
            title=title or f"{document.title} template",
            is_template=True,
            folder_id=folder_id,
            source_template_id=None,
        )
        audit_service.log(
            db,
            document_id=template.id,
            user_id=user.id,
            event_type="document_created",
            event_message=f"Template created from document '{document.title}'.",
        )
        db.commit()
        db.refresh(template)
        return template

    def duplicate(self, db: Session, *, template: Document, user: User, title: str | None) -> Document:
        copy = self._copy(
            db,
            source=template,
            user=user,
            title=title or f"{template.title} (Copy)",
            is_template=True,
            folder_id=template.folder_id,
            source_template_id=None,
        )
        audit_service.log(
            db,
            document_id=copy.id,
            user_id=user.id,
            event_type="document_created",
            event_message=f"Template duplicated from '{template.title}'.",
        )
        db.commit()
        db.refresh(copy)
        return copy

    def create_document(self, db: Session, *, template: Document, user: User, title: str | None, folder_id: str | None) -> Document:
        if template.archived_at:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Archived templates cannot be used")
        if folder_id:
            folder_service.get_for_user(db, folder_id=folder_id, user=user)
        document = self._copy(
            db,
            source=template,
            user=user,
            title=title or template.title,
            is_template=False,
            folder_id=folder_id if folder_id is not None else template.folder_id,
            source_template_id=template.id,
        )
        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="document_created",
            event_message=f"Created document from template '{template.title}'.",
        )
        crm_integration_service.trigger_document_created(db, document=document)
        db.commit()
        db.refresh(document)
        return document

    # ---------- usage ----------

    def usage(self, db: Session, *, template: Document, days: int = 30) -> TemplateUsageResponse:
        children = list(
            db.scalars(
                select(Document).where(
                    Document.organization_id == template.organization_id,
                    Document.source_template_id == template.id,
                )
            ).unique()
        )
        completed = sum(1 for child in children if child.status == DocumentStatus.completed)

        sender_names = {
            row.id: row.name
            for row in db.scalars(
                select(User).where(User.id.in_({child.sender_id for child in children} or {""}))
            ).unique()
        }
        tally: dict[str, int] = {}
        for child in children:
            name = sender_names.get(child.sender_id, "Unknown")
            tally[name] = tally.get(name, 0) + 1
        by_sender = [TemplateUsageSender(name=name, count=count) for name, count in sorted(tally.items(), key=lambda item: -item[1])]

        # One bucket per day, oldest first, so the client can draw a sparkline.
        today = datetime.now(timezone.utc).date()
        series = [0] * days
        for child in children:
            created = child.created_at
            if created is None:
                continue
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            delta = (today - created.date()).days
            if 0 <= delta < days:
                series[days - 1 - delta] += 1

        return TemplateUsageResponse(
            template_id=template.id,
            use_count=len(children),
            completed_copies=completed,
            by_sender=by_sender,
            series=series,
        )


template_service = TemplateService()
