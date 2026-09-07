"""The notification feed — the header bell and the full notifications page
(ACT-4).

A notification belongs to *one user in one organization*, and every query here
filters on both. Filtering on `user_id` alone would be enough to keep one
user's rows out of another's, but a platform admin who switches the tenant
they are acting on would keep seeing rows raised inside the tenant they left,
so the organization is part of the identity of a row, not just decoration.

Reads are the caller's own rows only — there is no "notifications for another
user" route, because nothing in the product needs one and adding one would put
a cross-user read behind a bell.

The bell and the page are the same endpoint at two page sizes. The badge count
is computed independently of every filter, so filtering the page never makes
the header lie about how much is waiting.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.mixins import now_utc
from app.models.notification import Notification
from app.models.user import User
from app.schemas.notification import (
    NotificationBulkRequest,
    NotificationFacets,
    NotificationFeed,
    NotificationRow,
    NotificationStatus,
    NotificationWriteResponse,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

#: The bell is a peek at what is recent; the page asks for more.
DEFAULT_LIMIT = 20
MAX_LIMIT = 200

#: Tones the producer can raise, in the order the page offers them as filters.
TONES = ("bad", "warn", "good", "info")


def _mine(user: User):
    """Every statement in this module starts here. See the module docstring."""
    return (Notification.user_id == user.id) & (
        Notification.organization_id == user.organization_id
    )


def _unread(db: Session, user: User) -> int:
    """The header badge: every unread row, filters and paging ignored."""
    return int(
        db.execute(
            select(func.count())
            .select_from(Notification)
            .where(_mine(user), Notification.read_at.is_(None))
        ).scalar_one()
    )


def _facets(db: Session, user: User, *, since_days: int | None, q: str | None) -> NotificationFacets:
    """Counts for the filter controls.

    Scoped by the time and text filters (which every chip shares) but *not* by
    tone or read state — a chip has to say how many rows it would select, and
    a count computed after its own filter would only ever echo the selection.
    """
    base = select(Notification).where(_mine(user))
    base = _apply_search(_apply_since(base, since_days), q)
    rows = base.subquery()

    tone_counts = {
        tone: count
        for tone, count in db.execute(
            select(rows.c.tone, func.count()).select_from(rows).group_by(rows.c.tone)
        ).all()
    }
    read_counts = db.execute(
        select(rows.c.read_at.is_(None), func.count()).select_from(rows).group_by(rows.c.read_at.is_(None))
    ).all()
    unread = next((count for is_unread, count in read_counts if is_unread), 0)
    read = next((count for is_unread, count in read_counts if not is_unread), 0)

    return NotificationFacets(
        # Every tone the page can offer is present, zero included, so a filter
        # control does not appear and disappear as rows are read or deleted.
        tones={tone: int(tone_counts.get(tone, 0)) for tone in TONES},
        unread=int(unread),
        read=int(read),
    )


def _apply_since(stmt, since_days: int | None):
    if not since_days:
        return stmt
    return stmt.where(Notification.created_at >= now_utc() - timedelta(days=since_days))


def _apply_search(stmt, q: str | None):
    """Free text over the title and the detail line.

    Both, not just the title: the titles are a short fixed vocabulary
    ("Recipient signed"), so the envelope name a user would actually search for
    only ever appears in the detail.
    """
    term = (q or "").strip()
    if not term:
        return stmt
    like = f"%{term}%"
    return stmt.where(
        or_(
            Notification.title.ilike(like),
            func.cast(Notification.detail, String).ilike(like),
        )
    )


@router.get("", response_model=NotificationFeed)
def list_notifications(
    status_filter: NotificationStatus = Query(NotificationStatus.all, alias="status"),
    tone: str | None = Query(None),
    q: str | None = Query(None, max_length=200),
    since_days: int | None = Query(None, ge=1, le=365),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationFeed:
    if tone is not None and tone not in TONES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown tone: {tone}",
        )

    stmt = _apply_search(_apply_since(select(Notification).where(_mine(user)), since_days), q)
    if status_filter is NotificationStatus.unread:
        stmt = stmt.where(Notification.read_at.is_(None))
    elif status_filter is NotificationStatus.read:
        stmt = stmt.where(Notification.read_at.is_not(None))
    if tone is not None:
        stmt = stmt.where(Notification.tone == tone)

    total = int(db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one())
    rows = db.execute(
        stmt.order_by(Notification.created_at.desc(), Notification.id.desc())
        .offset(offset)
        .limit(limit)
    ).scalars().all()

    return NotificationFeed(
        items=[NotificationRow.model_validate(row) for row in rows],
        # Deliberately independent of every filter and of `limit`: the badge
        # counts everything waiting, whatever this page happened to return.
        unread=_unread(db, user),
        total=total,
        facets=_facets(db, user, since_days=since_days, q=q),
    )


def _owned(db: Session, user: User, notification_id: str) -> Notification:
    row = db.execute(
        select(Notification).where(_mine(user), Notification.id == notification_id)
    ).scalar_one_or_none()
    # A row belonging to someone else is a 404, not a 403: the caller has no
    # business learning that the id exists.
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return row


@router.post("/{notification_id}/read", response_model=NotificationWriteResponse)
def mark_read(
    notification_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationWriteResponse:
    row = _owned(db, user, notification_id)
    updated = 0
    if row.read_at is None:
        row.read_at = now_utc()
        updated = 1
        db.commit()
    return NotificationWriteResponse(updated=updated, unread=_unread(db, user))


@router.post("/{notification_id}/unread", response_model=NotificationWriteResponse)
def mark_unread(
    notification_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationWriteResponse:
    """Undo for a misclick — reading a row is otherwise irreversible, and the
    page's actions are bulk ones where a misclick is easy."""
    row = _owned(db, user, notification_id)
    updated = 0
    if row.read_at is not None:
        row.read_at = None
        updated = 1
        db.commit()
    return NotificationWriteResponse(updated=updated, unread=_unread(db, user))


@router.delete("/{notification_id}", response_model=NotificationWriteResponse)
def delete_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationWriteResponse:
    row = _owned(db, user, notification_id)
    db.delete(row)
    db.commit()
    return NotificationWriteResponse(deleted=1, unread=_unread(db, user))


@router.post("/read-all", response_model=NotificationWriteResponse)
def mark_all_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationWriteResponse:
    updated = db.execute(
        update(Notification)
        .where(_mine(user), Notification.read_at.is_(None))
        .values(read_at=now_utc())
    ).rowcount
    if updated:
        db.commit()
    return NotificationWriteResponse(updated=int(updated or 0), unread=_unread(db, user))


@router.post("/clear-read", response_model=NotificationWriteResponse)
def clear_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationWriteResponse:
    """Tidy the page without touching anything still waiting to be seen.

    Scoped to read rows on purpose: a "clear all" that silently discarded
    unread notifications would lose the only in-app record of an event.
    """
    deleted = db.execute(
        delete(Notification).where(_mine(user), Notification.read_at.is_not(None))
    ).rowcount
    if deleted:
        db.commit()
    return NotificationWriteResponse(deleted=int(deleted or 0), unread=_unread(db, user))


@router.post("/bulk", response_model=NotificationWriteResponse)
def bulk(
    payload: NotificationBulkRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> NotificationWriteResponse:
    """Apply one action to the rows the user selected.

    Ids the caller does not own are ignored rather than rejected: the scoping
    predicate does the filtering, so a stale selection (a row deleted in
    another tab) still applies to the rest instead of failing the whole batch.
    The response says how many rows were actually touched.
    """
    ids = list(dict.fromkeys(payload.ids))
    scope = (_mine(user)) & (Notification.id.in_(ids))

    if payload.action == "delete":
        deleted = db.execute(delete(Notification).where(scope)).rowcount
        if deleted:
            db.commit()
        return NotificationWriteResponse(deleted=int(deleted or 0), unread=_unread(db, user))

    if payload.action == "read":
        stmt = update(Notification).where(scope, Notification.read_at.is_(None)).values(read_at=now_utc())
    else:
        stmt = update(Notification).where(scope, Notification.read_at.is_not(None)).values(read_at=None)

    updated = db.execute(stmt).rowcount
    if updated:
        db.commit()
    return NotificationWriteResponse(updated=int(updated or 0), unread=_unread(db, user))
