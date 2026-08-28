from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.operations import ActivityEntry, ActivityPage

router = APIRouter(prefix="/api/activity", tags=["activity"])


def _base_query():
    """Audit rows joined to their document.

    `AuditLog` has no organization column of its own — it reaches the tenant
    through its document, so every query here joins rather than filtering
    directly, which is what keeps the scoping honest.
    """
    return select(AuditLog, Document).join(Document, Document.id == AuditLog.document_id)


def _entries(db: Session, rows, include_org: bool) -> list[ActivityEntry]:
    org_names: dict[str, str] = {}
    if include_org:
        ids = {document.organization_id for _, document in rows}
        if ids:
            org_names = {
                org_id: name
                for org_id, name in db.execute(
                    select(Organization.id, Organization.name).where(Organization.id.in_(ids))
                ).all()
            }

    user_names: dict[str, str] = {}
    user_ids = {log.user_id for log, _ in rows if log.user_id}
    if user_ids:
        user_names = {
            user_id: name
            for user_id, name in db.execute(select(User.id, User.name).where(User.id.in_(user_ids))).all()
        }

    recipient_emails: dict[str, str] = {}
    recipient_ids = {log.recipient_id for log, _ in rows if log.recipient_id}
    if recipient_ids:
        recipient_emails = {
            rid: email
            for rid, email in db.execute(
                select(Recipient.id, Recipient.email).where(Recipient.id.in_(recipient_ids))
            ).all()
        }

    entries: list[ActivityEntry] = []
    for log, document in rows:
        actor = None
        if log.user_id:
            actor = user_names.get(log.user_id)
        elif log.recipient_id:
            actor = recipient_emails.get(log.recipient_id)
        entries.append(
            ActivityEntry(
                id=log.id,
                created_at=log.created_at,
                event_type=log.event_type,
                event_message=log.event_message,
                document_id=document.id,
                document_title=document.title,
                actor=actor or "system",
                ip_address=log.ip_address,
                organization_id=document.organization_id if include_org else None,
                organization_name=org_names.get(document.organization_id) if include_org else None,
            )
        )
    return entries


def _apply_filters(query, event_type: str | None, search: str | None, since_days: int | None):
    if event_type and event_type != "all":
        query = query.where(AuditLog.event_type == event_type)
    if search:
        term = f"%{search.lower()}%"
        query = query.where(
            func.lower(AuditLog.event_message).like(term) | func.lower(Document.title).like(term)
        )
    if since_days:
        query = query.where(AuditLog.created_at >= now_utc() - timedelta(days=since_days))
    return query


@router.get("", response_model=ActivityPage)
def organization_activity(
    event_type: str | None = Query(default=None),
    search: str | None = Query(default=None),
    since_days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ActivityPage:
    """The caller's own tenant activity — the audit trail and log views."""
    base = _base_query().where(Document.organization_id == user.organization_id)
    filtered = _apply_filters(base, event_type, search, since_days)

    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    rows = db.execute(filtered.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)).all()

    types = db.scalars(
        select(AuditLog.event_type)
        .join(Document, Document.id == AuditLog.document_id)
        .where(Document.organization_id == user.organization_id)
        .distinct()
    ).all()

    return ActivityPage(entries=_entries(db, rows, include_org=False), total=total, event_types=sorted(types))


@router.get("/platform", response_model=ActivityPage)
def platform_activity(
    event_type: str | None = Query(default=None),
    search: str | None = Query(default=None),
    since_days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ActivityPage:
    """Activity across every tenant."""
    filtered = _apply_filters(_base_query(), event_type, search, since_days)
    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    rows = db.execute(filtered.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)).all()
    types = db.scalars(select(AuditLog.event_type).distinct()).all()
    return ActivityPage(entries=_entries(db, rows, include_org=True), total=total, event_types=sorted(types))
