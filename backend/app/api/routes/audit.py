from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.audit import AuditLogResponse
from app.services.document_service import document_service


router = APIRouter(prefix="/api/documents/{document_id}/audit-logs", tags=["audit"])


@router.get("", response_model=list[AuditLogResponse])
def list_audit_logs(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[AuditLogResponse]:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return sorted(document.audit_logs, key=lambda item: item.created_at, reverse=True)

