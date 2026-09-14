"""Sandbox control surface (API-11).

Every route here acts on the *caller's own* sandbox. The sandbox is addressed
the same way any other request addresses it — a ``test``-mode API key, or the
``X-SignerPro-Sandbox`` header on a session call — so there is no path here
that lets a caller name someone else's organization, and no path that reaches
live data: ``seed`` and ``reset`` both go through ``_require_sandbox``.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.database import get_db
from app.models.user import User
from app.schemas.sandbox import SandboxResetResponse, SandboxStatusResponse
from app.services.sandbox_service import sandbox_service


router = APIRouter(prefix="/api/sandbox", tags=["sandbox"])


@router.get("", response_model=SandboxStatusResponse)
def sandbox_status(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SandboxStatusResponse:
    """Describe the organization this request resolved to.

    Called without the sandbox header it reports the live organization with
    ``is_sandbox`` false — which is how a client can prove which side of the
    boundary it is talking to instead of trusting its own toggle.
    """
    return SandboxStatusResponse.model_validate(
        sandbox_service.status_payload(db, organization_id=user.organization_id)
    )


@router.post("/seed", response_model=SandboxStatusResponse, status_code=201)
def seed_sandbox(
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SandboxStatusResponse:
    """Populate the sandbox with contacts and documents across the statuses
    worth testing against. Additive, so it can be called more than once."""
    return SandboxStatusResponse.model_validate(
        sandbox_service.seed(db, organization_id=user.organization_id, sender=user)
    )


@router.post("/reset", response_model=SandboxResetResponse)
def reset_sandbox(
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SandboxResetResponse:
    """Delete every document and contact in the sandbox.

    Refused outright unless the request resolved to a sandbox organization, so
    the destructive verb has no reachable path to live records.
    """
    return SandboxResetResponse.model_validate(
        sandbox_service.reset(db, organization_id=user.organization_id)
    )
