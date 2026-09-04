"""GDPR Article 17 erasure requests.

Platform-admin only, and deliberately so: erasure is irreversible, it is
cross-tenant by nature (a signer's address appears in many tenants' documents),
and honouring a request is a controller-level decision, not something a tenant
admin should be able to trigger against an arbitrary address.

The response is a report of what was erased *and what was retained, with the
basis*. See ``erasure_service`` for why an audit trail cannot be rewritten.
"""

from hashlib import sha256

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.deps import request_ip, require_platform_admin
from app.core.database import get_db
from app.models.user import User
from app.services.erasure_service import erasure_service
from app.services.platform_service import record_platform_audit

router = APIRouter(prefix="/api/platform/erasure", tags=["platform"])


class ErasureRequest(BaseModel):
    email: EmailStr


class ErasureResponse(BaseModel):
    subject_email: str
    erased: dict[str, int]
    retained: dict[str, int]
    retention_basis: str


@router.post("", response_model=ErasureResponse)
def erase_subject(
    payload: ErasureRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ErasureResponse:
    report = erasure_service.erase_subject(db, email=payload.email)

    # The erasure itself is auditable -- but writing the address we were just
    # asked to forget into a table nobody prunes would defeat the request. A
    # SHA-256 of it lets an operator confirm that a specific request was
    # honoured (hash the address and compare) without retaining the address.
    subject_digest = sha256(report.subject_email.encode()).hexdigest()
    record_platform_audit(
        db,
        action="gdpr.erasure",
        actor=admin,
        detail=f"Erasure request honoured for subject sha256:{subject_digest}",
        ip_address=request_ip(request),
        metadata={"subject_sha256": subject_digest, "erased": report.erased, "retained": report.retained},
    )
    db.commit()

    return ErasureResponse(
        subject_email=report.subject_email,
        erased=report.erased,
        retained=report.retained,
        retention_basis=report.retention_basis,
    )
