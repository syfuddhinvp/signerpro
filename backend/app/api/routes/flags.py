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
from app.models.platform_setting import Certification, IpAllowlistEntry, SecurityPosture
from app.models.user import User
from app.schemas.platform import (
    CertificationRow,
    CertificationUpdate,
    ComplianceResponse,
    FeatureFlagResponse,
    FeatureFlagUpdate,
    FlagOverridesResponse,
    FlagOverridesUpdate,
    IpAllowlistEntryCreate,
    IpAllowlistEntryRow,
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


@platform_router.get("/ip-allowlist", response_model=list[IpAllowlistEntryRow])
def list_ip_allowlist(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[IpAllowlistEntryRow]:
    rows = db.scalars(select(IpAllowlistEntry).order_by(IpAllowlistEntry.created_at)).all()
    return [IpAllowlistEntryRow.model_validate(row) for row in rows]


@platform_router.post("/ip-allowlist", response_model=IpAllowlistEntryRow, status_code=status.HTTP_201_CREATED)
def add_ip_allowlist_entry(
    payload: IpAllowlistEntryCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> IpAllowlistEntryRow:
    import ipaddress

    try:
        ipaddress.ip_network(payload.cidr, strict=False)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{payload.cidr}' is not a valid CIDR range"
        ) from exc

    existing = db.scalar(select(IpAllowlistEntry).where(IpAllowlistEntry.cidr == payload.cidr))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This range is already on the allowlist")

    entry = IpAllowlistEntry(cidr=payload.cidr, label=payload.label, created_by_user_id=admin.id)
    db.add(entry)
    platform_service.record_platform_audit(
        db,
        action="ip_allowlist.added",
        actor=admin,
        detail=f"Added {payload.cidr} to the platform admin IP allowlist",
        ip_address=request_ip(request),
        metadata={"cidr": payload.cidr},
    )
    db.commit()
    db.refresh(entry)
    return IpAllowlistEntryRow.model_validate(entry)


@platform_router.delete("/ip-allowlist/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_ip_allowlist_entry(
    entry_id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> None:
    entry = db.get(IpAllowlistEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Allowlist entry not found")
    db.delete(entry)
    platform_service.record_platform_audit(
        db,
        action="ip_allowlist.removed",
        actor=admin,
        detail=f"Removed {entry.cidr} from the platform admin IP allowlist",
        ip_address=request_ip(request),
        metadata={"cidr": entry.cidr},
    )
    db.commit()
    return None


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
        certifications=[
            CertificationRow(**platform_service.certification_view(row)) for row in certifications
        ],
        last_key_rotation_at=last_rotation,
        rotation_interval_days=platform_service.KEY_ROTATION_INTERVAL_DAYS,
        key_rotation_implemented=implemented,
    )


@platform_router.patch("/compliance/certifications/{certification_id}", response_model=CertificationRow)
def update_certification(
    certification_id: str,
    payload: CertificationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> CertificationRow:
    """Record what the operator knows about one certification.

    ``certified`` is the only status a customer would read as proof, so it is
    the only one with a precondition: the auditor, the assessment date and a
    link to the report must all be present once the change is applied. Without
    that the row is a claim with nothing behind it, which is exactly what the
    compliance panel exists to avoid.
    """
    platform_service.ensure_certifications(db)
    row = db.get(Certification, certification_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Certification not found")

    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return CertificationRow(**platform_service.certification_view(row))

    new_status = changes.get("status", row.status)
    if new_status not in platform_service.CERTIFICATION_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="status must be one of: "
            + ", ".join(sorted(platform_service.CERTIFICATION_STATUSES)),
        )

    url = changes.get("evidence_url", row.evidence_url)
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="evidence_url must be an http(s) link to the report",
        )

    resolved = {field: changes.get(field, getattr(row, field)) for field in platform_service.CERTIFICATION_EVIDENCE_FIELDS}
    if new_status == platform_service.CERTIFICATION_CERTIFIED:
        missing = [field for field, value in resolved.items() if not value]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A certified record needs its evidence: " + ", ".join(sorted(missing)),
            )

    assessed = changes.get("assessed_on", row.assessed_on)
    expires = changes.get("expires_on", row.expires_on)
    if assessed and expires and expires < assessed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="expires_on cannot precede assessed_on",
        )

    before = row.status
    for field, value in changes.items():
        setattr(row, field, value)
    row.updated_by_user_id = admin.id
    db.add(row)

    view = platform_service.certification_view(row)
    platform_service.record_platform_audit(
        db,
        action="certification.updated",
        actor=admin,
        detail=f"{row.name}: {before} → {view['effective_status']}"
        + (f" · evidence {row.evidence_url}" if row.evidence_url else " · no evidence recorded"),
        ip_address=request_ip(request),
        metadata={
            "certification_id": row.id,
            "name": row.name,
            "status": row.status,
            "effective_status": view["effective_status"],
            "auditor": row.auditor,
            "assessed_on": row.assessed_on.isoformat() if row.assessed_on else None,
            "expires_on": row.expires_on.isoformat() if row.expires_on else None,
            "evidence_url": row.evidence_url,
        },
    )
    db.commit()
    db.refresh(row)
    return CertificationRow(**platform_service.certification_view(row))
