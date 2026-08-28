"""Platform tenant management, directory and roles (ORG-4…ORG-7, ORG-9, ORG-10).

Every endpoint here is platform-only: a tenant administrator, however senior
inside their own organization, gets 403 from ``require_platform_admin``.
"""

from __future__ import annotations

import re
from datetime import timedelta
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import request_ip, require_platform_admin
from app.core.database import get_db
from app.core.security import hash_password
from app.models.document import Document
from app.models.enums import UserRole
from app.models.feature_flag import FeatureFlag, FeatureFlagOverride
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.plan import Plan
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.support import SupportTicket, TicketStatus
from app.models.system_log import SystemLog
from app.models.user import User
from app.schemas.platform import (
    DirectoryPage,
    DirectoryRoleUpdate,
    DirectoryUser,
    ImpersonationEnded,
    ImpersonationSessionResponse,
    ImpersonationStart,
    PermissionMatrix,
    PermissionRow,
    PlatformHealthRow,
    PlatformOverview,
    PlatformSeatCounts,
    PlatformTenantCounts,
    TenantCreate,
    TenantDetail,
    TenantFlagOverride,
    TenantFlagOverrideUpdate,
    TenantPage,
    TenantRow,
    TenantSuspend,
)
from app.services import platform_service

router = APIRouter(prefix="/api/saas", tags=["tenants"])


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "tenant"


def _unique_slug(db: Session, value: str) -> str:
    base = _slugify(value)
    slug = base
    suffix = 2
    while db.scalar(select(func.count()).select_from(Organization).where(Organization.slug == slug)):
        slug = f"{base[:74]}-{suffix}"
        suffix += 1
    return slug


def _tenant_query(q: str | None, status_filter: str | None, plan: str | None):
    query = select(Organization)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(
            or_(func.lower(Organization.name).like(term), func.lower(Organization.slug).like(term))
        )
    if status_filter and status_filter != "all":
        if status_filter == "suspended":
            query = query.where(Organization.suspended_at.is_not(None))
        else:
            query = query.where(
                Organization.suspended_at.is_(None),
                Organization.subscription_status == status_filter,
            )
    if plan and plan != "all":
        query = query.where(Organization.subscription_tier == plan)
    return query


def _directory_user(user: User, org: Organization | None) -> DirectoryUser:
    role_key = "super" if user.is_platform_admin else ("orgadmin" if user.role == UserRole.admin else "sender")
    return DirectoryUser(
        id=user.id,
        name=user.name,
        email=user.email,
        role=str(user.role),
        role_key=role_key,
        role_label=platform_service.ROLE_LABELS[role_key],
        is_platform_admin=user.is_platform_admin,
        organization_id=user.organization_id,
        organization_name=org.name if org else "Unknown organization",
        organization_slug=org.slug if org else None,
        status=user.status,
        mfa_enabled=user.mfa_enrolled_at is not None,
        mfa_method=user.mfa_method,
        last_active_at=user.last_active_at,
        created_at=user.created_at,
    )


# --- Tenants ---------------------------------------------------------------


@router.get("/tenants", response_model=TenantPage)
def list_tenants(
    q: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    plan: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantPage:
    """Paged tenant table with seat usage, plan, status and MRR."""
    query = _tenant_query(q, status_filter, plan)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    orgs = list(db.scalars(query.order_by(Organization.created_at.desc()).limit(limit).offset(offset)))
    return TenantPage(
        items=[TenantRow(**row) for row in platform_service.build_tenant_rows(db, orgs)], total=total
    )


@router.post("/tenants", response_model=TenantDetail, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    """Provision a tenant and its owner. The owner lands in ``invited`` status."""
    if db.scalar(select(User).where(func.lower(User.email) == payload.owner_email.lower())):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Owner email already in use")

    org = Organization(
        name=payload.name,
        slug=_unique_slug(db, payload.slug or payload.name),
        region=payload.region,
        company_size=payload.company_size,
        seats_licensed=payload.seats_licensed,
    )
    db.add(org)
    db.flush()

    owner = User(
        organization_id=org.id,
        name=payload.owner_name,
        email=str(payload.owner_email),
        password_hash=hash_password(token_urlsafe(24)),
        role=UserRole.admin,
        status="invited",
    )
    db.add(owner)
    db.flush()
    org.owner_user_id = owner.id

    if payload.plan_code:
        plan = db.scalar(select(Plan).where(Plan.code == payload.plan_code))
        if not plan:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown plan code")
        db.add(
            Subscription(
                organization_id=org.id, plan_id=plan.id, status=SubscriptionStatus.trialing
            )
        )
        org.subscription_tier = plan.code
        org.subscription_status = SubscriptionStatus.trialing

    platform_service.record_platform_audit(
        db,
        action="tenant.created",
        actor=admin,
        organization_id=org.id,
        detail=f"Created tenant {org.name} ({org.slug})",
        ip_address=request_ip(request),
        metadata={"owner_email": str(payload.owner_email), "plan_code": payload.plan_code},
    )
    db.commit()
    db.refresh(org)
    return _detail(db, org)


def _detail(db: Session, org: Organization) -> TenantDetail:
    base = platform_service.build_tenant_rows(db, [org])[0]
    overrides = db.execute(
        select(FeatureFlagOverride, FeatureFlag)
        .join(FeatureFlag, FeatureFlag.id == FeatureFlagOverride.flag_id)
        .where(FeatureFlagOverride.organization_id == org.id)
    ).all()
    open_tickets = db.scalar(
        select(func.count())
        .select_from(SupportTicket)
        .where(
            SupportTicket.organization_id == org.id,
            SupportTicket.status != TicketStatus.resolved,
        )
    ) or 0
    incidents = db.scalar(
        select(func.count())
        .select_from(SystemLog)
        .where(
            SystemLog.organization_id == org.id,
            SystemLog.level == "error",
            SystemLog.occurred_at >= now_utc() - timedelta(days=90),
        )
    ) or 0
    admins = db.scalars(
        select(User)
        .where(User.organization_id == org.id, User.role == UserRole.admin)
        .order_by(User.created_at)
    ).all()
    return TenantDetail(
        **base,
        accent_color=org.accent_color,
        logo_url=org.logo_url,
        billing_email=org.billing_email,
        billing_cycle=org.billing_cycle,
        live_mode_enabled=org.live_mode_enabled,
        open_ticket_count=open_tickets,
        incidents_90d=incidents,
        flag_overrides=[
            TenantFlagOverride(flag_id=flag.id, key=flag.key, enabled=override.enabled)
            for override, flag in overrides
        ],
        admins=[_directory_user(user, org) for user in admins],
    )


def _get_org(db: Session, org_id: str) -> Organization:
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return org


@router.get("/tenants/{org_id}", response_model=TenantDetail)
def get_tenant(
    org_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    return _detail(db, _get_org(db, org_id))


@router.post("/tenants/{org_id}/suspend", response_model=TenantDetail)
def suspend_tenant(
    org_id: str,
    payload: TenantSuspend,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    org = _get_org(db, org_id)
    if org.suspended_at is None:
        org.suspended_at = now_utc()
    org.suspension_reason = payload.reason
    db.add(org)
    ip = request_ip(request)
    platform_service.record_platform_audit(
        db,
        action="tenant.suspended",
        actor=admin,
        organization_id=org.id,
        detail=payload.reason,
        ip_address=ip,
    )
    platform_service.record_system_log(
        db,
        message=f"Tenant {org.name} suspended",
        level="warn",
        organization_id=org.id,
        actor_email=admin.email,
        ip_address=ip,
        payload={"reason": payload.reason},
    )
    db.commit()
    db.refresh(org)
    return _detail(db, org)


@router.post("/tenants/{org_id}/resume", response_model=TenantDetail)
def resume_tenant(
    org_id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    org = _get_org(db, org_id)
    org.suspended_at = None
    org.suspension_reason = None
    db.add(org)
    ip = request_ip(request)
    platform_service.record_platform_audit(
        db,
        action="tenant.reinstated",
        actor=admin,
        organization_id=org.id,
        detail=f"Reinstated tenant {org.name}",
        ip_address=ip,
    )
    platform_service.record_system_log(
        db,
        message=f"Tenant {org.name} reinstated",
        organization_id=org.id,
        actor_email=admin.email,
        ip_address=ip,
    )
    db.commit()
    db.refresh(org)
    return _detail(db, org)


# --- Per-tenant flag overrides (FLG-3, per tenant) --------------------------


@router.get("/tenants/{org_id}/flags", response_model=list[TenantFlagOverride])
def list_tenant_flag_overrides(
    org_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[TenantFlagOverride]:
    _get_org(db, org_id)
    rows = db.execute(
        select(FeatureFlagOverride, FeatureFlag)
        .join(FeatureFlag, FeatureFlag.id == FeatureFlagOverride.flag_id)
        .where(FeatureFlagOverride.organization_id == org_id)
    ).all()
    return [
        TenantFlagOverride(flag_id=flag.id, key=flag.key, enabled=override.enabled)
        for override, flag in rows
    ]


@router.put("/tenants/{org_id}/flags", response_model=list[TenantFlagOverride])
def set_tenant_flag_override(
    org_id: str,
    payload: TenantFlagOverrideUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[TenantFlagOverride]:
    """Force one flag on or off for this tenant; ``enabled: null`` clears it."""
    org = _get_org(db, org_id)
    flag = db.scalar(select(FeatureFlag).where(FeatureFlag.key == payload.key))
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature flag not found")

    override = db.scalar(
        select(FeatureFlagOverride).where(
            FeatureFlagOverride.flag_id == flag.id,
            FeatureFlagOverride.organization_id == org.id,
        )
    )
    if payload.enabled is None:
        if override:
            db.delete(override)
    elif override:
        override.enabled = payload.enabled
        db.add(override)
    else:
        db.add(
            FeatureFlagOverride(flag_id=flag.id, organization_id=org.id, enabled=payload.enabled)
        )

    platform_service.record_platform_audit(
        db,
        action="flag.override_set",
        actor=admin,
        organization_id=org.id,
        detail=f"{flag.key} override = {payload.enabled}",
        ip_address=request_ip(request),
        metadata={"key": flag.key, "enabled": payload.enabled},
    )
    db.commit()
    return list_tenant_flag_overrides(org_id, db=db, admin=admin)


# --- Impersonation (ORG-7) -------------------------------------------------


@router.post("/tenants/{org_id}/impersonate", response_model=ImpersonationSessionResponse)
def impersonate_tenant(
    org_id: str,
    payload: ImpersonationStart,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ImpersonationSessionResponse:
    """Issue a short-lived token acting as the tenant's owner.

    The session is recorded in ``impersonation_sessions`` and in the platform
    audit trail before the token is handed out, so a token can never exist
    without a trace of who took it and why.
    """
    org = _get_org(db, org_id)
    target = platform_service.owner_map(db, [org]).get(org.id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Tenant has no user to impersonate"
        )

    session, token = platform_service.start_impersonation(
        db,
        admin=admin,
        org=org,
        target=target,
        justification=payload.justification,
        ttl_seconds=payload.ttl_seconds,
        scopes=payload.scopes,
        ip_address=request_ip(request),
    )
    db.commit()
    db.refresh(session)
    return ImpersonationSessionResponse(
        id=session.id,
        access_token=token,
        organization_id=org.id,
        organization_name=org.name,
        impersonated_user_id=target.id,
        impersonated_user_email=target.email,
        justification=session.justification,
        scopes=list(session.scopes or []),
        expires_at=session.expires_at,
        ended_at=session.ended_at,
    )


@router.delete("/impersonation", response_model=ImpersonationEnded)
def stop_impersonation(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ImpersonationEnded:
    ended = platform_service.end_impersonation(db, admin=admin, ip_address=request_ip(request))
    db.commit()
    return ImpersonationEnded(ended_sessions=ended)


# --- Directory & roles (ORG-10) --------------------------------------------


@router.get("/directory", response_model=DirectoryPage)
def list_directory(
    q: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    role: str | None = Query(default=None, description="super | admin | sender"),
    mfa: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> DirectoryPage:
    """Cross-tenant user directory with role and MFA status."""
    query = select(User)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(or_(func.lower(User.name).like(term), func.lower(User.email).like(term)))
    if organization_id:
        query = query.where(User.organization_id == organization_id)
    if role and role != "all":
        if role == "super":
            query = query.where(User.is_platform_admin.is_(True))
        else:
            query = query.where(User.role == role, User.is_platform_admin.is_(False))
    if mfa is not None:
        query = query.where(
            User.mfa_enrolled_at.is_not(None) if mfa else User.mfa_enrolled_at.is_(None)
        )

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    users = list(db.scalars(query.order_by(User.created_at.desc()).limit(limit).offset(offset)))
    orgs = {
        org.id: org
        for org in db.scalars(
            select(Organization).where(Organization.id.in_({user.organization_id for user in users}))
        )
    } if users else {}
    return DirectoryPage(
        items=[_directory_user(user, orgs.get(user.organization_id)) for user in users], total=total
    )


@router.patch("/directory/{user_id}/role", response_model=DirectoryUser)
def assign_directory_role(
    user_id: str,
    payload: DirectoryRoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> DirectoryUser:
    """Assign a platform or tenant role. ``super`` grants platform access."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    role = payload.role
    if role in {"super", "orgadmin"} or role in {UserRole.admin, "admin"}:
        target_role = UserRole.admin
        platform = role == "super"
    elif role in {"sender", "viewer"}:
        target_role = UserRole.sender
        platform = False
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role")

    if user.id == admin.id and not platform:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot drop your own platform access"
        )

    # Never leave a tenant without an administrator.
    if user.role == UserRole.admin and target_role != UserRole.admin:
        remaining = db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == user.organization_id,
                User.role == UserRole.admin,
                User.id != user.id,
            )
        )
        if not remaining:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An organization must keep at least one administrator",
            )

    user.role = target_role
    user.is_platform_admin = platform
    db.add(user)
    platform_service.record_platform_audit(
        db,
        action="user.role_assigned",
        actor=admin,
        organization_id=user.organization_id,
        detail=f"{user.email} -> {role}",
        ip_address=request_ip(request),
        metadata={"user_id": user.id, "role": role, "is_platform_admin": platform},
    )
    db.commit()
    db.refresh(user)
    return _directory_user(user, db.get(Organization, user.organization_id))


@router.get("/roles", response_model=PermissionMatrix)
def permission_matrix(admin: User = Depends(require_platform_admin)) -> PermissionMatrix:
    """The permission matrix the design shows, owned by the server."""
    return PermissionMatrix(
        columns=platform_service.ROLE_COLUMNS,
        column_labels=platform_service.ROLE_COLUMN_LABELS,
        permissions=[
            PermissionRow(label=label, allowed=allowed)
            for label, allowed in platform_service.PERMISSION_MATRIX
        ],
    )


# --- Platform overview (ORG-9) ---------------------------------------------


@router.get("/overview", response_model=PlatformOverview)
def platform_overview(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> PlatformOverview:
    orgs = list(db.scalars(select(Organization)))
    rows = platform_service.build_tenant_rows(db, orgs)
    suspended = sum(1 for row in rows if row["status"] == "suspended")
    trial = sum(1 for row in rows if row["status"] == SubscriptionStatus.trialing)
    active = sum(1 for row in rows if row["status"] == SubscriptionStatus.active)

    since = now_utc() - timedelta(days=30)
    envelopes = db.scalar(
        select(func.count()).select_from(Document).where(Document.created_at >= since)
    ) or 0
    incidents = db.scalar(
        select(func.count())
        .select_from(SystemLog)
        .where(SystemLog.level == "error", SystemLog.occurred_at >= now_utc() - timedelta(days=90))
    ) or 0

    mrr = sum(row["mrr_cents"] for row in rows)
    # Twelve-month series reconstructed from the tenants that existed in each
    # month, so the chart is derived from rows rather than invented.
    series: list[int] = []
    for months_ago in range(11, -1, -1):
        cutoff = now_utc() - timedelta(days=30 * months_ago)
        series.append(
            sum(
                row["mrr_cents"]
                for row in rows
                if platform_service.as_aware(row["created_at"]) <= cutoff
            )
        )

    errors_24h = db.scalar(
        select(func.count())
        .select_from(SystemLog)
        .where(SystemLog.level == "error", SystemLog.occurred_at >= now_utc() - timedelta(days=1))
    ) or 0
    health = [
        PlatformHealthRow(
            component="API",
            detail=f"{errors_24h} errors in the last 24h",
            tone="bad" if errors_24h > 50 else "warn" if errors_24h else "good",
        ),
        PlatformHealthRow(
            component="Signing",
            detail=f"{envelopes} envelopes in the last 30 days",
            tone="good",
        ),
        PlatformHealthRow(
            component="Tenants",
            detail=f"{suspended} suspended",
            tone="warn" if suspended else "good",
        ),
    ]

    return PlatformOverview(
        tenants=PlatformTenantCounts(
            total=len(rows), trial=trial, suspended=suspended, active=active
        ),
        seats=PlatformSeatCounts(
            provisioned=sum(row["seats_licensed"] for row in rows),
            activated=sum(row["seats_activated"] for row in rows),
        ),
        envelopes_30d=envelopes,
        mrr_cents=mrr,
        incidents_90d=incidents,
        uptime_pct=round(100.0 - min(errors_24h * 0.01, 5.0), 3),
        mrr_series=series,
        health=health,
    )
