from fastapi import APIRouter, Depends, Response
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
from app.services import pades_service
from app.services.audit_service import audit_service
from app.services.document_service import document_service
from app.services.pdf_service import pdf_service


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
    result = audit_service.verify_for_document(db, document)
    if result["valid"] and expected_head is not None and expected_head != result["chain_head"]:
        result["valid"] = False
        result["reason"] = "chain head does not match the expected head"
    return AuditChainVerification(**result)


@certificate_router.get("/summary", response_model=CertificateSummaryResponse)
def certificate_summary(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> CertificateSummaryResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    logs = list(document.audit_logs)
    verification = audit_service.verify_for_document(db, document)
    files = pdf_service.verify_stored_files(document)
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
        signature_level=pades_service.describe(),
        final_sha256=document.final_sha256,
        original_sha256=document.original_sha256,
        chain_head=verification["chain_head"],
        audit_entry_count=verification["entry_count"],
        chain_valid=verification["valid"],
        chain_invalid_reason=verification["reason"],
        **files,
    )


def _pdf_response(document, pdf_bytes: bytes, suffix: str) -> Response:
    safe_title = "".join(ch for ch in document.title if ch.isalnum() or ch in " -_").strip() or "document"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}{suffix}.pdf"'},
    )


@certificate_router.get(
    "/full",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "Document and certificate in one PDF"}},
)
def document_with_certificate(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    """The document and its certificate of completion in a single PDF.

    For a sealed envelope this *is* ``final.pdf`` — the certificate is already
    bound into it — so the bytes the ``final_sha256`` attests to are what gets
    downloaded. For one still in flight the two are stitched on demand.
    """

    document = document_service.get_for_user(db, document_id=document_id, user=user)
    pdf_bytes = pdf_service.build_document_with_certificate(db, document)
    return _pdf_response(document, pdf_bytes, "-signed-with-certificate")


@certificate_router.get(
    "/pdf",
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "Certificate of completion"}},
)
def certificate_pdf(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    """The certificate of completion as a PDF.

    Built on demand from the live audit chain rather than served from storage,
    so it is available for an in-flight envelope too and always reflects the
    trail as it stands. The identical pages are what `generate_final_pdf`
    appends to the sealed document.
    """

    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return _pdf_response(document, pdf_service.build_audit_certificate(db, document), "-certificate")
