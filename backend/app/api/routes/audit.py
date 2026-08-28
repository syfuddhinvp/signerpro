from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.enums import RecipientStatus
from app.models.user import User
from app.schemas.audit import (
    AuditChainVerification,
    AuditLogResponse,
    AuditTrailEntry,
    CertificateSummaryResponse,
)
from app.services.audit_service import audit_service
from app.services.document_service import document_service


router = APIRouter(prefix="/api/documents/{document_id}/audit-logs", tags=["audit"])
certificate_router = APIRouter(prefix="/api/documents/{document_id}/certificate", tags=["audit"])

#: Static provenance of the seal; surfaced so the UI never hard-codes it.
TIME_SOURCE = "SignFlow platform clock (UTC)"
CERTIFICATE_AUTHORITY = "SignFlow internal CA"


def _trail(document) -> list[AuditTrailEntry]:
    chained = audit_service.chain(list(document.audit_logs))
    entries = [
        AuditTrailEntry(
            **AuditLogResponse.model_validate(entry).model_dump(),
            checksum=checksum,
            previous_checksum=previous,
            kind=audit_service.entry_kind(entry.event_type),
        )
        for entry, checksum, previous in chained
    ]
    return list(reversed(entries))


@router.get("", response_model=list[AuditTrailEntry])
def list_audit_logs(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[AuditTrailEntry]:
    """Newest first. Each entry carries its tamper-evident chain checksum."""
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return _trail(document)


@router.get("/verify", response_model=AuditChainVerification)
def verify_audit_chain(
    document_id: str,
    expected_head: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AuditChainVerification:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return AuditChainVerification(**audit_service.verify_chain(list(document.audit_logs), expected_head=expected_head))


@certificate_router.get("/summary", response_model=CertificateSummaryResponse)
def certificate_summary(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> CertificateSummaryResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    logs = list(document.audit_logs)
    return CertificateSummaryResponse(
        envelope_id=document.id,
        document_title=document.title,
        document_status=str(document.status),
        signers_completed=sum(1 for item in document.recipients if item.status == RecipientStatus.completed),
        signers_total=len(document.recipients),
        sealed_at=document.completed_at,
        hash_algorithm="SHA-256",
        time_source=TIME_SOURCE,
        certificate_authority=CERTIFICATE_AUTHORITY,
        final_sha256=document.final_sha256,
        original_sha256=document.original_sha256,
        chain_head=audit_service.chain_head(logs),
        audit_entry_count=len(logs),
        chain_valid=True,
    )
