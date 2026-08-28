from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import TokenResponse
from app.schemas.invitation import (
    InvitationAcceptRequest,
    InvitationCreate,
    InvitationCreateResponse,
    InvitationResponse,
)
from app.services.invitation_service import invitation_service

router = APIRouter(prefix="/api/invitations", tags=["invitations"])


@router.post("/", response_model=InvitationCreateResponse, status_code=status.HTTP_201_CREATED)
def create_invitation(
    payload: InvitationCreate,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> InvitationCreateResponse:
    """Invite an email address to join the current user's organization."""
    return invitation_service.create(db, inviter=current_user, payload=payload)


@router.get("/", response_model=list[InvitationResponse])
def list_invitations(
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> list[InvitationResponse]:
    """List pending invitations for the current user's organization."""
    return invitation_service.list_pending(db, organization_id=current_user.organization_id)


@router.delete("/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invitation(
    invitation_id: str,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> None:
    """Revoke a pending invitation belonging to the current user's organization."""
    invitation_service.revoke(db, invitation_id=invitation_id, organization_id=current_user.organization_id)


@router.post("/accept", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def accept_invitation(payload: InvitationAcceptRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Public endpoint: redeem an invitation token and create the member account."""
    return invitation_service.accept(db, payload)
