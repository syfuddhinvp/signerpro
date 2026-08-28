from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.api import deps
from app.core.database import get_db
from app.models.user import User
from app.models.organization import Organization
from app.models.enums import UserRole
from app.schemas.auth import UserResponse
from app.schemas.organization import OrganizationResponse, OrganizationSettingsUpdate
from app.schemas.saas import OrganizationMemberRoleUpdate
from sqlalchemy import func, select

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
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> Organization:
    """
    Update organization-scoped SMTP and SMS configurations.
    Accessible only by administrators.
    """
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


@router.get("/me/members", response_model=list[UserResponse])
def list_my_organization_members(
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    """
    List the members of the current administrator's own organization.
    """
    return list(
        db.scalars(
            select(User).where(User.organization_id == current_user.organization_id).order_by(User.created_at)
        )
    )


@router.patch("/me/members/{user_id}/role", response_model=UserResponse)
def update_my_organization_member_role(
    user_id: str,
    payload: OrganizationMemberRoleUpdate,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> User:
    """
    Change the tenant role of a member of the administrator's own organization.
    Platform-admin status can never be granted here.
    """
    member = db.get(User, user_id)
    if not member or member.organization_id != current_user.organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    if member.role == UserRole.admin and payload.role != UserRole.admin:
        remaining_admins = db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == current_user.organization_id,
                User.role == UserRole.admin,
                User.id != member.id,
            )
        )
        if not remaining_admins:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An organization must keep at least one administrator",
            )

    member.role = payload.role
    db.add(member)
    db.commit()
    db.refresh(member)
    return member
