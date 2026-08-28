from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.plan import ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH
from app.models.usage_event import UsageEventType
from app.models.user import User
from app.schemas.document import DocumentResponse
from app.schemas.template import (
    TemplateCreateFromDocument,
    TemplateDuplicateRequest,
    TemplateListResponse,
    TemplateResponse,
    TemplateUpdate,
    TemplateUsageResponse,
    TemplateUseRequest,
)
from app.services.document_service import document_response, document_service
from app.services.entitlement_service import entitlement_service
from app.services.template_service import template_service


router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("", response_model=TemplateListResponse)
def list_templates(
    q: str | None = Query(default=None),
    owner: str | None = Query(default=None, description="'me' restricts to templates you own"),
    sort: str = Query(default="recent", description="recent | name | uses"),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateListResponse:
    items, total = template_service.list_for_user(
        db,
        user=user,
        q=q,
        owner=owner,
        sort=sort,
        include_archived=include_archived,
        limit=limit,
        offset=offset,
    )
    return TemplateListResponse(items=items, total=total)


@router.post("/from-document/{document_id}", response_model=TemplateResponse, status_code=201)
def create_template_from_document(
    document_id: str,
    payload: TemplateCreateFromDocument | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateResponse:
    payload = payload or TemplateCreateFromDocument()
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    template = template_service.create_from_document(
        db, document=document, user=user, title=payload.title, folder_id=payload.folder_id
    )
    return template_service.single_response(db, template)


@router.get("/{template_id}", response_model=TemplateResponse)
def get_template(template_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> TemplateResponse:
    template = template_service.get_for_user(db, template_id=template_id, user=user)
    return template_service.single_response(db, template)


@router.patch("/{template_id}", response_model=TemplateResponse)
def update_template(
    template_id: str,
    payload: TemplateUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateResponse:
    template = template_service.get_for_user(db, template_id=template_id, user=user)
    template = template_service.update(db, template=template, user=user, payload=payload)
    return template_service.single_response(db, template)


@router.post("/{template_id}/duplicate", response_model=TemplateResponse, status_code=201)
def duplicate_template(
    template_id: str,
    payload: TemplateDuplicateRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateResponse:
    payload = payload or TemplateDuplicateRequest()
    template = template_service.get_for_user(db, template_id=template_id, user=user)
    copy = template_service.duplicate(db, template=template, user=user, title=payload.title)
    return template_service.single_response(db, copy)


@router.post("/{template_id}/archive", response_model=TemplateResponse)
def archive_template(template_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> TemplateResponse:
    template = template_service.get_for_user(db, template_id=template_id, user=user)
    template = template_service.archive(db, template=template, archived=True)
    return template_service.single_response(db, template)


@router.post("/{template_id}/restore", response_model=TemplateResponse)
def restore_template(template_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> TemplateResponse:
    template = template_service.get_for_user(db, template_id=template_id, user=user)
    template = template_service.archive(db, template=template, archived=False)
    return template_service.single_response(db, template)


@router.post("/{template_id}/use", response_model=DocumentResponse, status_code=201)
def use_template(
    template_id: str,
    payload: TemplateUseRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentResponse:
    """Create a real document from a template; the copy keeps ``source_template_id``
    so the template's ``use_count`` stays derived rather than stored."""
    payload = payload or TemplateUseRequest()
    entitlement_service.check_entitlement(db, user.organization_id, ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH, amount=1)
    template = template_service.get_for_user(db, template_id=template_id, user=user)
    document = template_service.create_document(
        db, template=template, user=user, title=payload.title, folder_id=payload.folder_id
    )
    entitlement_service.record_usage(
        db,
        organization_id=user.organization_id,
        event_type=UsageEventType.document_created,
        document_id=document.id,
    )
    db.commit()
    return document_response(document)


@router.get("/{template_id}/usage", response_model=TemplateUsageResponse)
def template_usage(
    template_id: str,
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateUsageResponse:
    template = template_service.get_for_user(db, template_id=template_id, user=user)
    return template_service.usage(db, template=template, days=days)
