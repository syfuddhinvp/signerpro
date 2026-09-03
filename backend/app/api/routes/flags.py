"""Feature flags, security posture and compliance (FLG-1…FLG-6).

Reads and writes of the catalogue are platform-only. The single tenant-facing
endpoint, ``GET /api/flags``, returns the *resolved* boolean map for the
caller's own organization and never exposes rollout percentages or the
per-tenant override list of other tenants.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, request_ip, require_platform_admin
from app.core.database import get_db
from app.models.feature_flag import FeatureFlag, FeatureFlagOverride
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.platform_setting import SecurityPosture
from app.models.user import User
from app.schemas.platform import (
    CertificationRow,
    ComplianceResponse,
    FeatureFlagResponse,
    FeatureFlagUpdate,
    FlagOverridesResponse,
    FlagOverridesUpdate,
    SecurityPostureRow,
    SecurityPostureUpdate,
)
from app.services import platform_service

platform_router = APIRouter(prefix="/api/saas", tags=["feature-flags"])
tenant_router = APIRouter(prefix="/api", tags=["feature-flags"])


def _flag_response(db: Session, flag: FeatureFlag, editors: dict[str, str]) -> FeatureFlagResponse:
    overrides = db.scalar(
        select(func.count()).select_from(FeatureFlagOverride).where(FeatureFlagOverride.flag_id == flag.id)
    ) or 0
    return FeatureFlagResponse(
        id=flag.id,
        key=flag.key,
        description=flag.description,
        environment=flag.environment,
        enabled=flag.enabled,
        rollout_pct=flag.rollout_pct,
        updated_at=flag.updated_at,
        updated_by=editors.get(flag.updated_by_user_id) if flag.updated_by_user_id else None,
        override_count=overrides,
    )


def _editors(db: Session, flags: list[FeatureFlag]) -> dict[str, str]:
    ids = {flag.updated_by_user_id for flag in flags if flag.updated_by_user_id}
    if not ids:
        return {}
    return {
        user_id: email
        for user_id, email in db.execute(select(User.id, User.email).where(User.id.in_(ids))).all()
    }


@platform_router.get("/flags", response_model=list[FeatureFlagResponse])
def list_flags(
    environment: str | None = Query(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[FeatureFlagResponse]:
    flags = platform_service.ensure_feature_flags(db)
    if environment and environment != "all":
        flags = [flag for flag in flags if flag.environment == environment]
    editors = _editors(db, flags)
    return [_flag_response(db, flag, editors) for flag in flags]


@platform_router.patch("/flags/{key}", response_model=FeatureFlagResponse)
def update_flag(
    key: str,
    payload: FeatureFlagUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> FeatureFlagResponse:
    platform_service.ensure_feature_flags(db)
    flag = db.scalar(select(FeatureFlag).where(FeatureFlag.key == key))
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature flag not found")

    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(flag, field, value)
    flag.updated_by_user_id = admin.id
    db.add(flag)

    ip = request_ip(request)
    detail = " · ".join(
        [flag.key, f"{flag.rollout_pct}% {flag.environment}", "on" if flag.enabled else "off"]
    )
    platform_service.record_platform_audit(
        db,
        action="flag.changed",
        actor=admin,
        detail=detail,
        ip_address=ip,
        metadata={"key": flag.key, **changes},
    )
    platform_service.record_system_log(
        db,
        message=f"Feature flag changed — {detail}",
        source="admin",
        actor_email=admin.email,
        ip_address=ip,
        payload={"key": flag.key, "changes": changes},
    )
    db.commit()
    db.refresh(flag)
    return _flag_response(db, flag, _editors(db, [flag]))


@platform_router.get("/flags/{key}/overrides", response_model=FlagOverridesResponse)
def get_flag_overrides(
    key: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> FlagOverridesResponse:
    flag = db.scalar(select(FeatureFlag).where(FeatureFlag.key == key))
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature flag not found")
    ids = db.scalars(
        select(FeatureFlagOverride.organization_id).where(
            FeatureFlagOverride.flag_id == flag.id, FeatureFlagOverride.enabled.is_(True)
        )
    ).all()
    return FlagOverridesResponse(key=flag.key, organization_ids=list(ids))


@platform_router.put("/flags/{key}/overrides", response_model=FlagOverridesResponse)
def set_flag_overrides(
    key: str,
    payload: FlagOverridesUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> FlagOverridesResponse:
    """Replace the force-on tenant list for one flag."""
    flag = db.scalar(select(FeatureFlag).where(FeatureFlag.key == key))
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature flag not found")

    wanted = set(payload.organization_ids)
    if wanted:
        known = set(
            db.scalars(select(Organization.id).where(Organization.id.in_(wanted))).all()
        )
        unknown = wanted - known
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown organization ids: {', '.join(sorted(unknown))}",
            )

    existing = {
        row.organization_id: row
        for row in db.scalars(
            select(FeatureFlagOverride).where(FeatureFlagOverride.flag_id == flag.id)
        ).all()
    }
    for org_id, row in existing.items():
        if org_id not in wanted:
            db.delete(row)
    for org_id in wanted:
        row = existing.get(org_id)
        if row is None:
            db.add(FeatureFlagOverride(flag_id=flag.id, organization_id=org_id, enabled=True))
        else:
            row.enabled = True
            db.add(row)

    platform_service.record_platform_audit(
        db,
        action="flag.overrides_replaced",
        actor=admin,
        detail=f"{flag.key} forced on for {len(wanted)} tenant(s)",
        ip_address=request_ip(request),
        metadata={"key": flag.key, "organization_ids": sorted(wanted)},
    )
    db.commit()
    return FlagOverridesResponse(key=flag.key, organization_ids=sorted(wanted))


@tenant_router.get("/flags", response_model=dict[str, bool])
def resolved_flags(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    """``{key: bool}`` for the caller's tenant (enabled ∧ rollout, override wins)."""
    platform_service.ensure_feature_flags(db)
    return platform_service.resolve_flags(db, user.organization_id)


# --- Security posture & compliance -----------------------------------------


@platform_router.get("/security-posture", response_model=list[SecurityPostureRow])
def get_security_posture(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[SecurityPostureRow]:
    rows = platform_service.ensure_security_posture(db)
    order = [spec["key"] for spec in platform_service.SECURITY_POSTURE_DEFAULTS]
    rows.sort(key=lambda row: order.index(row.key) if row.key in order else len(order))
    return [SecurityPostureRow(**platform_service.security_posture_view(row)) for row in rows]


@platform_router.patch("/security-posture", response_model=list[SecurityPostureRow])
def update_security_posture(
    payload: SecurityPostureUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[SecurityPostureRow]:
    platform_service.ensure_security_posture(db)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not changes:
        return get_security_posture(db=db, admin=admin)

    rows = {
        row.key: row
        for row in db.scalars(select(SecurityPosture).where(SecurityPosture.key.in_(changes))).all()
    }
    unknown = set(changes) - set(rows)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown security keys: {', '.join(sorted(unknown))}",
        )
    # These switches record *intent*; none of the six controls is implemented,
    # so the response reports enforced=False whatever is stored here. Saying so
    # in the audit detail keeps the trail from implying a control was turned on.
    for key, value in changes.items():
        rows[key].enabled = value
        rows[key].updated_by_user_id = admin.id
        db.add(rows[key])

    platform_service.record_platform_audit(
        db,
        action="security_posture.changed",
        actor=admin,
        detail=" · ".join(
            f"{key}={'on' if value else 'off'}"
            + ("" if key in platform_service.IMPLEMENTED_SECURITY_CONTROLS else " (not enforced: unimplemented)")
            for key, value in changes.items()
        ),
        ip_address=request_ip(request),
        metadata=changes,
    )
    db.commit()
    return get_security_posture(db=db, admin=admin)


@platform_router.get("/compliance", response_model=ComplianceResponse)
def get_compliance(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ComplianceResponse:
    certifications = platform_service.ensure_certifications(db)
    rotation = db.scalar(
        select(SecurityPosture).where(SecurityPosture.key == "keyRotation")
    )
    implemented = "keyRotation" in platform_service.IMPLEMENTED_SECURITY_CONTROLS
    # There is no key-rotation job. The previous implementation derived a
    # plausible-looking timestamp from the interval and returned it as if a
    # rotation had happened; a customer could have been shown that as evidence.
    last_rotation = None
    if implemented and rotation is not None and rotation.enabled:
        last_rotation = rotation.updated_at
    return ComplianceResponse(
        certifications=[CertificationRow.model_validate(row) for row in certifications],
        last_key_rotation_at=last_rotation,
        rotation_interval_days=platform_service.KEY_ROTATION_INTERVAL_DAYS,
        key_rotation_implemented=implemented,
    )
