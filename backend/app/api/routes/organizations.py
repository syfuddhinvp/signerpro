from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.api import deps
from app.core.database import get_db
from app.models.user import User
from app.models.organization import Organization
from app.models.enums import UserRole
from app.schemas.auth import UserResponse
from app.schemas.organization import (
    OrganizationOverview,
    OrganizationResponse,
    OrganizationSettingsUpdate,
)
from app.services.entitlement_service import entitlement_service
from app.services.organization_service import organization_service
from app.schemas.saas import OrganizationMemberRoleUpdate
from sqlalchemy import func, select
from fastapi import Query

router = APIRouter(prefix="/api/organizations", tags=["organizations"])


@router.get("/me", response_model=OrganizationResponse)
def get_my_organization(
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
) -> Organization:
    """The caller's own organization: profile, branding and non-secret gateway
    settings. Credentials are write-only and never echoed back."""
    return organization_service.get(db, organization_id=current_user.organization_id)


@router.patch("/me", response_model=OrganizationResponse)
def update_my_organization(
    payload: OrganizationSettingsUpdate,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> Organization:
    """Update tenant profile (ORG-1) and the SMTP/SMS gateway configuration.

    Org admins own their own identity: ``slug``, ``region``, ``company_size``,
    ``seats_licensed``, ``accent_color`` and ``logo_url`` are all self-service.
    A slug already taken by another tenant answers 409.
    """
    fields_set = payload.model_fields_set
    if ("accent_color" in fields_set and payload.accent_color is not None) or (
        "logo_url" in fields_set and payload.logo_url is not None
    ):
        entitlement_service.check_custom_branding(db, current_user.organization_id)
    org = organization_service.get(db, organization_id=current_user.organization_id)
    return organization_service.update_settings(db, org=org, payload=payload)


@router.get("/me/overview", response_model=OrganizationOverview)
def my_organization_overview(
    range: str = Query(default="30d", pattern="^(7d|30d|90d|12m)$"),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
) -> OrganizationOverview:
    """The tenant dashboard aggregate (ORG-2): envelope stats, seat usage,
    invoiced spend, attention items and team activity, all derived."""
    return organization_service.overview(db, user=current_user, range_key=range)


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
