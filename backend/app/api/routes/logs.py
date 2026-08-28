"""Request/system logs and the administrative audit stream (ACT-1…ACT-3).

``GET /api/logs`` is tenant-scoped by ``organization_id`` and never returns
platform-only rows (those have a null organization). ``GET /api/saas/logs`` is
platform-wide and includes them.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.core.database import get_db
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.platform_audit import PlatformAuditEntry
from app.models.system_log import SystemLog
from app.models.user import User
from app.schemas.platform import (
    PlatformAuditPage,
    PlatformAuditRow,
    SystemLogPage,
    SystemLogRow,
)

LOG_SOURCES = ["api", "webhook", "auth", "billing", "signing", "admin"]
LOG_LEVELS = ["info", "warn", "error"]

tenant_router = APIRouter(prefix="/api/logs", tags=["logs"])
platform_router = APIRouter(prefix="/api/saas", tags=["logs"])


def _filtered(query, source: str | None, level: str | None, q: str | None, since_days: int | None):
    if source and source != "all":
        query = query.where(SystemLog.source == source)
    if level and level != "all":
        query = query.where(SystemLog.level == level)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(SystemLog.message).like(term),
                func.lower(SystemLog.actor_email).like(term),
                func.lower(SystemLog.request_id).like(term),
            )
        )
    if since_days:
        query = query.where(SystemLog.occurred_at >= now_utc() - timedelta(days=since_days))
    return query


def _rows(db: Session, logs: list[SystemLog], *, include_org: bool) -> list[SystemLogRow]:
    orgs: dict[str, Organization] = {}
    if include_org:
        ids = {log.organization_id for log in logs if log.organization_id}
        if ids:
            orgs = {
                org.id: org
                for org in db.scalars(select(Organization).where(Organization.id.in_(ids)))
            }
    return [
        SystemLogRow(
            id=log.id,
            occurred_at=log.occurred_at,
            level=log.level,
            source=log.source,
            message=log.message,
            status_code=log.status_code,
            latency_ms=log.latency_ms,
            request_id=log.request_id,
            actor_email=log.actor_email,
            ip_address=log.ip_address,
            organization_id=log.organization_id,
            organization_slug=orgs[log.organization_id].slug
            if include_org and log.organization_id in orgs
            else None,
            organization_name=orgs[log.organization_id].name
            if include_org and log.organization_id in orgs
            else None,
            payload=log.payload,
        )
        for log in logs
    ]


def _page(db: Session, query, *, limit: int, offset: int, include_org: bool) -> SystemLogPage:
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    logs = list(db.scalars(query.order_by(SystemLog.occurred_at.desc()).limit(limit).offset(offset)))
    return SystemLogPage(
        items=_rows(db, logs, include_org=include_org),
        total=total,
        sources=LOG_SOURCES,
        levels=LOG_LEVELS,
    )


@tenant_router.get("", response_model=SystemLogPage)
def tenant_logs(
    source: str | None = Query(default=None),
    level: str | None = Query(default=None),
    q: str | None = Query(default=None),
    since_days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SystemLogPage:
    """The caller's own tenant logs, with the expandable payload the UI renders."""
    query = _filtered(
        select(SystemLog).where(SystemLog.organization_id == user.organization_id),
        source,
        level,
        q,
        since_days,
    )
    return _page(db, query, limit=limit, offset=offset, include_org=False)


@platform_router.get("/logs", response_model=SystemLogPage)
def platform_logs(
    source: str | None = Query(default=None),
    level: str | None = Query(default=None),
    q: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    since_days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> SystemLogPage:
    query = _filtered(select(SystemLog), source, level, q, since_days)
    if organization_id:
        query = query.where(SystemLog.organization_id == organization_id)
    return _page(db, query, limit=limit, offset=offset, include_org=True)


@platform_router.get("/logs/{log_id}", response_model=SystemLogRow)
def platform_log_detail(
    log_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> SystemLogRow:
    log = db.get(SystemLog, log_id)
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Log entry not found")
    return _rows(db, [log], include_org=True)[0]


@platform_router.get("/audit", response_model=PlatformAuditPage)
def platform_audit(
    action: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    q: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> PlatformAuditPage:
    """Administrative audit: flag flips, impersonation, suspensions, roles."""
    query = select(PlatformAuditEntry)
    if action and action != "all":
        query = query.where(PlatformAuditEntry.action == action)
    if organization_id:
        query = query.where(PlatformAuditEntry.organization_id == organization_id)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(PlatformAuditEntry.action).like(term),
                func.lower(PlatformAuditEntry.detail).like(term),
                func.lower(PlatformAuditEntry.actor_email).like(term),
            )
        )

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    entries = list(
        db.scalars(
            query.order_by(PlatformAuditEntry.created_at.desc()).limit(limit).offset(offset)
        )
    )
    org_names: dict[str, str] = {}
    ids = {entry.organization_id for entry in entries if entry.organization_id}
    if ids:
        org_names = {
            org_id: name
            for org_id, name in db.execute(
                select(Organization.id, Organization.name).where(Organization.id.in_(ids))
            ).all()
        }
    return PlatformAuditPage(
        items=[
            PlatformAuditRow(
                id=entry.id,
                action=entry.action,
                actor_email=entry.actor_email,
                detail=entry.detail,
                ip_address=entry.ip_address,
                organization_id=entry.organization_id,
                organization_name=org_names.get(entry.organization_id)
                if entry.organization_id
                else None,
                metadata=entry.entry_metadata,
                occurred_at=entry.created_at,
            )
            for entry in entries
        ],
        total=total,
    )
