from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.api import deps
from app.core.database import get_db
from app.models.user import User
from app.models.organization import Organization
from app.schemas.organization import OrganizationResponse, OrganizationSettingsUpdate

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("/me", response_model=OrganizationResponse)
def get_my_organization(
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    """
    Retrieve the current authenticated user's organization settings.
    """
    org = db.get(Organization, current_user.organization_id)
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )
    return org


@router.patch("/me", response_model=OrganizationResponse)
def update_my_organization(
    payload: OrganizationSettingsUpdate,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    """
    Update organization-scoped SMTP and SMS configurations.
    Accessible only by administrators.
    """
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage organization configurations",
        )

    org = db.get(Organization, current_user.organization_id)
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    # Apply changes
    update_data = payload.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(org, field, val)

    db.add(org)
    db.commit()
    db.refresh(org)
    return org
