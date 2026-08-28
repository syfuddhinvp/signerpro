from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import request_ip, require_platform_admin
from app.core.database import get_db
from app.models.user import User
from app.models.organization import Organization
from app.models.document import Document
from app.schemas.platform import DirectoryPage, TenantRow
from app.services import platform_service
from app.schemas.saas import (
    SaaSMetrics,
    SaaSOrganizationResponse,
    SaaSOrganizationUpdate,
    SaaSUserResponse,
    SaaSUserUpdate,
)

router = APIRouter(prefix="/api/saas", tags=["saas"])


@router.get("/metrics", response_model=SaaSMetrics)
def get_saas_metrics(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> SaaSMetrics:
    """
    Retrieve global metrics across the entire SaaS environment.
    """
    total_orgs = db.query(Organization).count()
    total_users = db.query(User).count()
    total_docs = db.query(Document).count()
    active_subs = db.query(Organization).filter(Organization.subscription_status == "active").count()

    # Get counts per tier
    tiers = ["free", "growth", "enterprise"]
    tier_counts = {}
    for tier in tiers:
        tier_counts[tier] = db.query(Organization).filter(Organization.subscription_tier == tier).count()

    return SaaSMetrics(
        total_organizations=total_orgs,
        total_users=total_users,
        total_documents=total_docs,
        active_subscriptions=active_subs,
        tier_counts=tier_counts,
    )


@router.get("/organizations", response_model=list[TenantRow])
def list_organizations(
    q: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    plan: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[TenantRow]:
    """
    List all tenants/organizations with plan, seat usage, status and MRR.

    Same rows as ``GET /api/saas/tenants``; that endpoint adds the total for
    paging. Kept here because the frontend's ``saas.organizations`` calls it.
    """
    from app.api.routes.tenants import _tenant_query

    query = _tenant_query(q, status_filter, plan)
    orgs = list(db.scalars(query.order_by(Organization.created_at.desc()).limit(limit).offset(offset)))
    return [TenantRow(**row) for row in platform_service.build_tenant_rows(db, orgs)]


@router.patch("/organizations/{org_id}", response_model=SaaSOrganizationResponse)
def update_organization_subscription(
    org_id: str,
    payload: SaaSOrganizationUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> SaaSOrganizationResponse:
    """
    Modify subscription plan tier, status, and expiration for an organization.
    """
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found",
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, val in update_data.items():
        setattr(org, field, val)

    db.add(org)
    db.commit()
    db.refresh(org)

    users_count = db.query(User).filter(User.organization_id == org.id).count()
    docs_count = db.query(Document).filter(Document.organization_id == org.id).count()

    return SaaSOrganizationResponse(
        id=org.id,
        name=org.name,
        subscription_tier=org.subscription_tier,
        subscription_status=org.subscription_status,
        subscription_expires_at=org.subscription_expires_at,
        created_at=org.created_at,
        users_count=users_count,
        documents_count=docs_count,
    )


@router.get("/users", response_model=DirectoryPage)
def list_users(
    q: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    role: str | None = Query(default=None),
    mfa: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> DirectoryPage:
    """
    Cross-tenant user directory with role, MFA status and last activity.
    Identical to ``GET /api/saas/directory``.
    """
    from app.api.routes.tenants import list_directory

    return list_directory(
        q=q,
        organization_id=organization_id,
        role=role,
        mfa=mfa,
        limit=limit,
        offset=offset,
        db=db,
        admin=admin,
    )


@router.patch("/users/{user_id}/role", response_model=SaaSUserResponse)
def update_user_role(
    user_id: str,
    payload: SaaSUserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> SaaSUserResponse:
    """
    Update role (e.g. promoting to admin, or demoting to sender) for a user globally.
    """
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.role = payload.role
    db.add(user)
    platform_service.record_platform_audit(
        db,
        action="user.role_assigned",
        actor=admin,
        organization_id=user.organization_id,
        detail=f"{user.email} -> {payload.role}",
        ip_address=request_ip(request),
        metadata={"user_id": user.id, "role": payload.role},
    )
    db.commit()
    db.refresh(user)

    return SaaSUserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        organization_id=user.organization_id,
        organization_name=user.organization.name if user.organization else "No Organization",
    )
