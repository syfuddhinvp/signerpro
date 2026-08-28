"""The public, API-key authenticated surface (API-1…API-6).

Every route here is authenticated by an `X-API-Key` header, scoped to the
key's organization and gated on the key's scopes. API keys never carry
platform-admin powers: nothing in this module consults `is_platform_admin`.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import ApiKeyPrincipal, require_api_scope
from app.core.database import get_db
from app.models.contact import Contact
from app.models.document import Document
from app.models.enums import DocumentStatus
from app.models.user import User
from app.schemas.audit import AuditLogResponse, AuditTrailEntry
from app.schemas.document import DocumentResponse
from app.services.audit_service import audit_service
from app.services.document_service import document_response


router = APIRouter(prefix="/api/v1", tags=["public-api"])


def _document(db: Session, document_id: str, organization_id: str) -> Document:
    document = db.get(Document, document_id)
    if not document or document.organization_id != organization_id or document.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return document


@router.get("/whoami")
def whoami(principal: ApiKeyPrincipal = Depends(require_api_scope())) -> dict:
    return {
        "organization_id": principal.organization_id,
        "mode": principal.mode,
        "scopes": principal.scopes,
        "key_id": principal.api_key.id,
        "is_platform_admin": False,
    }


@router.get("/documents", response_model=list[DocumentResponse])
def list_documents(
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    principal: ApiKeyPrincipal = Depends(require_api_scope("documents:read")),
) -> list[DocumentResponse]:
    stmt = select(Document).where(
        Document.organization_id == principal.organization_id,
        Document.deleted_at.is_(None),
    )
    if status_filter:
        stmt = stmt.where(Document.status == status_filter)
    return [document_response(item) for item in db.scalars(stmt.order_by(Document.created_at.desc()))]


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    principal: ApiKeyPrincipal = Depends(require_api_scope("documents:read")),
) -> DocumentResponse:
    return document_response(_document(db, document_id, principal.organization_id))


@router.get("/documents/{document_id}/audit-logs", response_model=list[AuditTrailEntry])
def document_audit_trail(
    document_id: str,
    db: Session = Depends(get_db),
    principal: ApiKeyPrincipal = Depends(require_api_scope("audit:read")),
) -> list[AuditTrailEntry]:
    document = _document(db, document_id, principal.organization_id)
    chained = audit_service.chain(list(document.audit_logs))
    return list(
        reversed(
            [
                AuditTrailEntry(
                    **AuditLogResponse.model_validate(entry).model_dump(),
                    checksum=checksum,
                    previous_checksum=previous,
                    kind=audit_service.entry_kind(entry.event_type),
                )
                for entry, checksum, previous in chained
            ]
        )
    )


@router.get("/users")
def list_users(
    db: Session = Depends(get_db),
    principal: ApiKeyPrincipal = Depends(require_api_scope("users:read")),
) -> list[dict]:
    rows = db.scalars(select(User).where(User.organization_id == principal.organization_id).order_by(User.created_at))
    return [{"id": item.id, "name": item.name, "email": item.email, "role": str(item.role), "status": item.status} for item in rows]


@router.get("/contacts")
def list_contacts(
    db: Session = Depends(get_db),
    principal: ApiKeyPrincipal = Depends(require_api_scope("contacts:read")),
) -> list[dict]:
    rows = db.scalars(select(Contact).where(Contact.organization_id == principal.organization_id).order_by(Contact.created_at))
    return [{"id": item.id, "name": item.name, "email": item.email} for item in rows]
