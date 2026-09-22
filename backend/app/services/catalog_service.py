"""The platform template catalog: browse, curate, and import into a tenant.

Importing is the only write a tenant can make here, and it is a *copy*: the
catalog entry is a blueprint, and the import stamps it out as an ordinary org
template (``Document`` with ``is_template``). Nothing downstream — use,
duplicate, archive, the builder — needs to know the catalog exists.
"""

from __future__ import annotations

import re
from decimal import Decimal
from io import BytesIO

from fastapi import HTTPException, UploadFile, status
from pypdf import PdfReader
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.catalog_template import CatalogTemplate
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.enums import DocumentStatus, DocumentVersionType, RecipientStatus, WorkflowType
from app.models.field import Field
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.catalog import (
    CatalogField,
    CatalogImportRequest,
    CatalogListResponse,
    CatalogRole,
    CatalogTemplateCreate,
    CatalogTemplateDetail,
    CatalogTemplateResponse,
    CatalogTemplateUpdate,
)
from app.core.config import get_settings
from app.core.hashing import sha256_bytes
from app.core.storage import storage
from app.services.audit_service import audit_service
from app.services import conversion_service
from app.services.folder_service import folder_service


SORTABLE = {"recommended", "title", "recent"}


class CatalogService:
    # ---------- validation ----------

    def _validate_shape(self, *, roles: list[CatalogRole], fields: list[CatalogField]) -> None:
        """Every field must name a role that exists.

        ``fields.recipient_id`` is NOT NULL, so a field whose role is missing
        would fail at flush time during an import — on the tenant's request,
        long after the curator made the mistake. Reject it at authoring time.
        """
        keys = [role.key for role in roles]
        if len(set(keys)) != len(keys):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role keys must be unique")
        known = set(keys)
        unknown = sorted({field.role for field in fields} - known)
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Fields reference unknown roles: {', '.join(unknown)}",
            )
        if fields and not roles:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A template with fields needs at least one role")

    def _check_pages(self, *, fields: list[CatalogField], page_count: int) -> None:
        over = [field.label for field in fields if field.page_number > page_count]
        if over:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Fields placed beyond page {page_count}: {', '.join(over)}",
            )

    def _pull_fields_onto(self, entry: CatalogTemplate, *, page_count: int) -> list[str]:
        """Move fields past ``page_count`` onto the last page. Returns their labels.

        Used only when the entry's *first* PDF arrives. Until then its
        ``page_count`` is an assertion nobody has checked against a file --
        the seeded blueprints declare one, and a curator typing an entry by
        hand guesses another -- so the arriving file is the better authority
        and the placement bends to it rather than the other way round.

        The box keeps its x/y, which is a position on the wrong page, not a
        correct one. That is why the labels come back: the caller says which
        fields moved so the curator re-places them, instead of the entry
        quietly looking finished.
        """
        moved: list[str] = []
        rewritten: list[dict] = []
        for field in entry.fields or []:
            if int(field.get("page_number", 1)) > page_count:
                moved.append(str(field.get("label", "")))
                field = {**field, "page_number": page_count}
            rewritten.append(field)
        # Reassign rather than mutate: ``fields`` is a plain JSON column, so an
        # in-place edit is invisible to the session and would never be written.
        if moved:
            entry.fields = rewritten
        return moved

    # ---------- lookup ----------

    def _roles(self, entry: CatalogTemplate) -> list[CatalogRole]:
        return [CatalogRole.model_validate(role) for role in (entry.roles or [])]

    def _fields(self, entry: CatalogTemplate) -> list[CatalogField]:
        return [CatalogField.model_validate(field) for field in (entry.fields or [])]

    def get(self, db: Session, *, catalog_id: str, published_only: bool) -> CatalogTemplate:
        """Look an entry up by id, or by slug.

        Both are unique and their shapes cannot collide -- an id is a UUID,
        a slug is ``^[a-z0-9]+(?:-[a-z0-9]+)*$`` -- so accepting either is
        unambiguous. It exists because a document authored for the catalog
        records the *slug* (``source_catalog_slug``), which is what survives an
        entry being rebuilt; the builder can then save back without first
        having to resolve an id it was never given.
        """
        entry = db.get(CatalogTemplate, catalog_id)
        if entry is None:
            entry = db.scalar(select(CatalogTemplate).where(CatalogTemplate.slug == catalog_id))
        if not entry or (published_only and not entry.published):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog template not found")
        return entry

    def imported_slugs(self, db: Session, *, organization_id: str) -> set[str]:
        rows = db.scalars(
            select(Document.source_catalog_slug).where(
                Document.organization_id == organization_id,
                Document.is_template == True,  # noqa: E712
                Document.deleted_at.is_(None),
                Document.source_catalog_slug.is_not(None),
            )
        ).all()
        return set(rows)

    def response(self, entry: CatalogTemplate, *, imported: bool = False) -> CatalogTemplateResponse:
        return CatalogTemplateResponse(
            id=entry.id,
            slug=entry.slug,
            title=entry.title,
            description=entry.description,
            category=entry.category,
            authority=entry.authority,
            jurisdiction=entry.jurisdiction,
            form_revision=entry.form_revision,
            tags=list(entry.tags or []),
            page_count=entry.page_count,
            role_count=len(entry.roles or []),
            field_count=len(entry.fields or []),
            has_file=bool(entry.file_path),
            published=entry.published,
            sort_order=entry.sort_order,
            imported=imported,
            created_at=entry.created_at,
            updated_at=entry.updated_at,
        )

    def detail(self, entry: CatalogTemplate, *, imported: bool = False) -> CatalogTemplateDetail:
        base = self.response(entry, imported=imported)
        return CatalogTemplateDetail(
            **base.model_dump(),
            roles=self._roles(entry),
            fields=self._fields(entry),
        )

    # ---------- list ----------

    def list_entries(
        self,
        db: Session,
        *,
        organization_id: str | None,
        published_only: bool,
        q: str | None = None,
        category: str | None = None,
        jurisdiction: str | None = None,
        sort: str = "recommended",
        limit: int = 50,
        offset: int = 0,
    ) -> CatalogListResponse:
        if sort not in SORTABLE:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"sort must be one of {sorted(SORTABLE)}")
        query = select(CatalogTemplate)
        if published_only:
            query = query.where(CatalogTemplate.published == True)  # noqa: E712
        if category:
            query = query.where(CatalogTemplate.category == category)
        if jurisdiction:
            query = query.where(CatalogTemplate.jurisdiction == jurisdiction)
        if q:
            needle = f"%{q.lower()}%"
            query = query.where(
                or_(
                    func.lower(CatalogTemplate.title).like(needle),
                    func.lower(func.coalesce(CatalogTemplate.description, "")).like(needle),
                    func.lower(func.coalesce(CatalogTemplate.authority, "")).like(needle),
                )
            )
        entries = list(db.scalars(query).unique())

        if sort == "title":
            entries.sort(key=lambda entry: entry.title.lower())
        elif sort == "recent":
            entries.sort(key=lambda entry: entry.created_at, reverse=True)
        else:
            # Curated order first, then alphabetical so ties are stable.
            entries.sort(key=lambda entry: (entry.sort_order, entry.title.lower()))

        imported = self.imported_slugs(db, organization_id=organization_id) if organization_id else set()
        # Categories come from the whole matched set, not the page, so paging
        # never makes a filter option disappear.
        categories = sorted({entry.category for entry in entries})
        page = entries[offset : offset + limit]
        return CatalogListResponse(
            items=[self.response(entry, imported=entry.slug in imported) for entry in page],
            total=len(entries),
            categories=categories,
        )

    # ---------- platform curation ----------

    def create(self, db: Session, *, payload: CatalogTemplateCreate, user: User) -> CatalogTemplate:
        if db.scalar(select(CatalogTemplate).where(CatalogTemplate.slug == payload.slug)):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Slug '{payload.slug}' is already in use")
        self._validate_shape(roles=payload.roles, fields=payload.fields)
        self._check_pages(fields=payload.fields, page_count=payload.page_count)
        entry = CatalogTemplate(
            slug=payload.slug,
            title=payload.title,
            description=payload.description,
            category=payload.category,
            authority=payload.authority,
            jurisdiction=payload.jurisdiction,
            form_revision=payload.form_revision,
            tags=payload.tags or [],
            page_count=payload.page_count,
            roles=[role.model_dump() for role in payload.roles],
            fields=[field.model_dump(mode="json") for field in payload.fields],
            published=payload.published,
            sort_order=payload.sort_order,
            created_by_user_id=user.id,
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry

    def update(self, db: Session, *, entry: CatalogTemplate, payload: CatalogTemplateUpdate) -> CatalogTemplate:
        data = payload.model_dump(exclude_unset=True)
        roles = payload.roles if payload.roles is not None else self._roles(entry)
        fields = payload.fields if payload.fields is not None else self._fields(entry)
        page_count = data.get("page_count", entry.page_count)
        self._validate_shape(roles=roles, fields=fields)
        self._check_pages(fields=fields, page_count=page_count)

        for key, value in data.items():
            if key == "roles":
                entry.roles = [role.model_dump() for role in payload.roles or []]
            elif key == "fields":
                entry.fields = [field.model_dump(mode="json") for field in payload.fields or []]
            else:
                setattr(entry, key, value)
        db.commit()
        db.refresh(entry)
        return entry

    def delete(self, db: Session, *, entry: CatalogTemplate) -> None:
        # Templates already imported are independent copies and are untouched:
        # a tenant never loses work because the platform retired a form.
        db.delete(entry)
        db.commit()

    async def attach_file(
        self, db: Session, *, entry: CatalogTemplate, upload: UploadFile
    ) -> tuple[CatalogTemplate, list[str]]:
        """Store the authoritative form behind a catalog entry.

        Mirrors ``document_service.upload_pdf``: same conversion, same size
        cap, same "must actually be a readable PDF" checks. It does not meter
        storage, because the file belongs to the platform rather than to any
        tenant, and it may be replaced -- a form's publisher revises it, and
        re-uploading is how a curator follows.
        """
        filename = upload.filename or "form.pdf"
        if not conversion_service.is_supported(filename):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported file type. Upload a PDF, an image, or a document such as .docx.",
            )
        settings = get_settings()
        content = await upload.read(settings.max_upload_bytes + 1)
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds size limit")
        content = conversion_service.convert_to_pdf(filename=filename, content=content, fit="fit")
        if not content.startswith(b"%PDF"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is not a valid PDF")
        try:
            page_count = len(PdfReader(BytesIO(content)).pages)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF could not be read") from exc
        if page_count < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF must contain at least one page")

        # A file already sits behind this entry, so its placement was built
        # against real pages: a shorter replacement would strand fields no
        # signer can reach, and only the curator can say which page they
        # belong on now. Refuse, and let them re-place first.
        moved: list[str] = []
        if entry.file_path:
            self._check_pages(fields=self._fields(entry), page_count=page_count)
        else:
            moved = self._pull_fields_onto(entry, page_count=page_count)

        relative_path = f"catalog/{entry.id}/form.pdf"
        storage.write_bytes(relative_path, content)
        entry.file_path = relative_path
        entry.sha256 = sha256_bytes(content)
        entry.page_count = page_count
        db.commit()
        db.refresh(entry)
        return entry, moved

    # ---------- import into a tenant ----------

    def import_to_org(
        self,
        db: Session,
        *,
        entry: CatalogTemplate,
        user: User,
        payload: CatalogImportRequest,
        require_published: bool = True,
    ) -> Document:
        """Stamp a blueprint out as an ordinary org template.

        ``require_published`` is False only for a curator authoring the entry
        itself: they build the placement in their own organization's builder
        and save it back, so they must be able to open an entry no tenant can
        see yet.
        """
        if require_published and not entry.published:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog template not found")
        if payload.folder_id:
            folder_service.get_for_user(db, folder_id=payload.folder_id, user=user)

        roles = self._roles(entry)
        fields = self._fields(entry)
        # Re-check on the way in: an entry published before the role rule
        # existed could still carry an orphan field, and NOT NULL would turn
        # that into a 500 on the tenant's request.
        self._validate_shape(roles=roles, fields=fields)

        template = Document(
            organization_id=user.organization_id,
            sender_id=user.id,
            owner_user_id=user.id,
            title=payload.title or entry.title,
            status=DocumentStatus.draft,
            # More than one role means the order in the blueprint is meaningful.
            workflow_type=WorkflowType.sequential if len(roles) > 1 else WorkflowType.parallel,
            original_file_path=entry.file_path,
            original_sha256=entry.sha256,
            page_count=entry.page_count,
            is_template=True,
            doc_type=entry.category[:30],
            folder_id=payload.folder_id,
            source_catalog_slug=entry.slug,
        )
        db.add(template)
        db.flush()

        if entry.file_path and entry.sha256:
            db.add(
                DocumentVersion(
                    document_id=template.id,
                    version_type=DocumentVersionType.original,
                    file_path=entry.file_path,
                    sha256=entry.sha256,
                )
            )
            template.status = DocumentStatus.prepared

        recipient_ids: dict[str, str] = {}
        for role in sorted(roles, key=lambda item: item.signing_order):
            recipient = Recipient(
                document_id=template.id,
                # Blank on purpose: the sender fills in who signs when they
                # use the template, exactly as with a template they built.
                name="",
                email="",
                role_name=role.name,
                role=role.role,
                color=role.color,
                signing_order=role.signing_order,
                status=RecipientStatus.waiting,
            )
            db.add(recipient)
            db.flush()
            recipient_ids[role.key] = recipient.id

        for field in fields:
            db.add(
                Field(
                    document_id=template.id,
                    recipient_id=recipient_ids[field.role],
                    type=field.type,
                    label=field.label,
                    required=field.required,
                    page_number=field.page_number,
                    x=Decimal(str(field.x)),
                    y=Decimal(str(field.y)),
                    width=Decimal(str(field.width)),
                    height=Decimal(str(field.height)),
                    placeholder=field.placeholder,
                    default_value=field.default_value,
                    options=field.options,
                )
            )

        audit_service.log(
            db,
            document_id=template.id,
            user_id=user.id,
            event_type="document_created",
            event_message=f"Template imported from the platform catalog ('{entry.title}').",
        )
        db.commit()
        db.refresh(template)
        return template

    # ---------- authoring round-trip ----------

    def _role_key(self, recipient: Recipient, index: int) -> str:
        """A stable key for a recipient, derived from the role it plays.

        Keys tie a blueprint's fields to its roles, so they must survive a
        round-trip through the builder. The role name is the only thing a
        curator actually names, so it is the key; a nameless recipient falls
        back to its position.
        """
        source = (recipient.role_name or "").strip().lower()
        slug = re.sub(r"[^a-z0-9]+", "-", source).strip("-")[:40]
        return slug or f"role-{index + 1}"

    def draft_template(self, db: Session, *, entry: CatalogTemplate, user: User) -> Document:
        """The curator's own editable copy of an entry, for the builder.

        Reused rather than recreated: opening the builder twice must land on
        the same draft, or the second visit would silently discard the first
        one's placement. The draft lives in the curator's organization like
        any other template, so the builder needs no notion of the catalog.
        """
        existing = db.scalars(
            select(Document).where(
                Document.organization_id == user.organization_id,
                Document.owner_user_id == user.id,
                Document.is_template == True,  # noqa: E712
                Document.source_catalog_slug == entry.slug,
                Document.deleted_at.is_(None),
            )
        ).unique().all()
        if existing:
            # Newest wins if a curator somehow has several.
            return sorted(existing, key=lambda doc: doc.created_at)[-1]
        return self.import_to_org(
            db,
            entry=entry,
            user=user,
            payload=CatalogImportRequest(title=entry.title),
            require_published=False,
        )

    def adopt_template(self, db: Session, *, entry: CatalogTemplate, template: Document, user: User) -> CatalogTemplate:
        """Pull a template's roles, field placement and PDF into the entry.

        The inverse of an import. Every tenant that already imported this form
        keeps the copy they have — an import is a copy, not a link — so this
        changes what *future* imports produce, not what anyone already holds.
        """
        if template.organization_id != user.organization_id or not template.is_template:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

        recipients = sorted(template.recipients or [], key=lambda item: (item.signing_order, item.created_at))
        keys: dict[str, str] = {}
        roles: list[dict] = []
        for index, recipient in enumerate(recipients):
            key = self._role_key(recipient, index)
            # Two recipients can share a role name; keys must still be unique.
            if key in keys.values():
                key = f"{key}-{index + 1}"
            keys[recipient.id] = key
            roles.append(
                {
                    "key": key,
                    "name": recipient.role_name or recipient.name or f"Signer {index + 1}",
                    "signing_order": recipient.signing_order,
                    "role": recipient.role or "sign",
                    "color": recipient.color,
                }
            )

        fields: list[dict] = []
        for field in template.fields or []:
            key = keys.get(field.recipient_id)
            if key is None:
                # A field whose recipient vanished cannot be placed on import,
                # and `fields.recipient_id` is NOT NULL. Drop it here rather
                # than store a blueprint that 500s the first tenant to use it.
                continue
            fields.append(
                {
                    "role": key,
                    "type": field.type.value if hasattr(field.type, "value") else str(field.type),
                    "label": field.label,
                    "page_number": field.page_number,
                    "x": float(field.x),
                    "y": float(field.y),
                    "width": float(field.width),
                    "height": float(field.height),
                    "required": field.required,
                    "placeholder": field.placeholder,
                    "default_value": field.default_value,
                    "options": field.options,
                }
            )

        entry.roles = roles
        entry.fields = fields
        entry.page_count = max(template.page_count, 1)

        # The entry keeps its own copy of the PDF. Pointing at the template's
        # path would make every future import depend on a document the curator
        # is free to delete.
        if template.original_file_path and template.original_file_path != entry.file_path:
            content = storage.path(template.original_file_path).read_bytes()
            relative_path = f"catalog/{entry.id}/form.pdf"
            storage.write_bytes(relative_path, content)
            entry.file_path = relative_path
            entry.sha256 = sha256_bytes(content)

        self._check_pages(fields=self._fields(entry), page_count=entry.page_count)
        db.commit()
        db.refresh(entry)
        return entry



catalog_service = CatalogService()
