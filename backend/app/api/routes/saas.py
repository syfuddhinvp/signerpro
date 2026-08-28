from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.api.deps import require_platform_admin
from app.core.database import get_db
from app.models.user import User
from app.models.organization import Organization
from app.models.document import Document
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


@router.get("/organizations", response_model=list[SaaSOrganizationResponse])
def list_organizations(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[SaaSOrganizationResponse]:
    """
    List all tenants/organizations in the system with their subscription details.
    """
    orgs = db.query(Organization).all()
    results = []
    for org in orgs:
        users_count = db.query(User).filter(User.organization_id == org.id).count()
        docs_count = db.query(Document).filter(Document.organization_id == org.id).count()
        
        results.append(
            SaaSOrganizationResponse(
                id=org.id,
                name=org.name,
                subscription_tier=org.subscription_tier,
                subscription_status=org.subscription_status,
                subscription_expires_at=org.subscription_expires_at,
                created_at=org.created_at,
                users_count=users_count,
                documents_count=docs_count,
            )
        )
    return results


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


@router.get("/users", response_model=list[SaaSUserResponse])
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[SaaSUserResponse]:
    """
    List all registered users globally with their organization associations.
    """
    users = db.query(User).all()
    results = []
    for user in users:
        results.append(
            SaaSUserResponse(
                id=user.id,
                name=user.name,
                email=user.email,
                role=user.role,
                created_at=user.created_at,
                organization_id=user.organization_id,
                organization_name=user.organization.name if user.organization else "No Organization",
            )
        )
    return results


@router.patch("/users/{user_id}/role", response_model=SaaSUserResponse)
def update_user_role(
    user_id: str,
    payload: SaaSUserUpdate,
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
