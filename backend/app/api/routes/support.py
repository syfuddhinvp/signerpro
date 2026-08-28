"""Support tickets (SUP-1…SUP-8).

Two audiences share these routes. A tenant caller only ever sees its own
organization's tickets, and never an internal note; a platform admin sees
every tenant and can triage (priority, assignee, escalation). The visibility
rule lives in one place — ``_visible_messages`` — because "internal notes must
not leak" is the sort of rule that only holds if there is a single copy of it.
"""

from __future__ import annotations

from datetime import timedelta
from secrets import token_hex

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.core.database import get_db
from app.models.document import Document
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.support import SupportTicket, TicketMessage, TicketPriority, TicketStatus
from app.models.user import User
from app.schemas.operations import (
    PlatformTicketResponse,
    QueueTicketStats,
    QuickReply,
    SupportAgent,
    TenantTicketStats,
    TicketBucketCounts,
    TicketCreate,
    TicketDetailResponse,
    TicketMessageResponse,
    TicketPage,
    TicketReply,
    TicketResponse,
    TicketUpdate,
)
from app.services import platform_service

router = APIRouter(prefix="/api/support", tags=["support"])

OPEN_STATUSES = (TicketStatus.open, TicketStatus.pending, TicketStatus.escalated)

QUICK_REPLIES_PLATFORM = [
    QuickReply(
        label="Ask for logs",
        body="Could you share the request id and the exact timestamp (UTC) so we can pull the delivery log?",
    ),
    QuickReply(
        label="Send workaround",
        body=(
            "As an interim path, typed signatures carry the same legal weight and are recorded "
            "identically in the audit trail."
        ),
    ),
    QuickReply(
        label="Confirm fix ETA",
        body=(
            "Engineering has this in the current sprint — I will confirm the release window within "
            "one business day."
        ),
    ),
]

QUICK_REPLIES_TENANT = [
    QuickReply(label="Add urgency", body="This is blocking a signature due today — please treat as P1."),
    QuickReply(
        label="Attach envelope",
        body="Reproduced on the envelope linked to this ticket, page 1, signature field.",
    ),
    QuickReply(label="Request call", body="Could we get a 15-minute screen share with an engineer today?"),
]


def _visible_messages(ticket: SupportTicket, user: User) -> list[TicketMessage]:
    """Internal notes are for platform agents only (SUP-3)."""
    if user.is_platform_admin:
        return list(ticket.messages)
    return [message for message in ticket.messages if not message.is_internal]


def _context(db: Session, tickets: list[SupportTicket]) -> tuple[dict[str, Organization], dict[str, str], dict[str, str]]:
    org_ids = {ticket.organization_id for ticket in tickets}
    orgs = (
        {org.id: org for org in db.scalars(select(Organization).where(Organization.id.in_(org_ids)))}
        if org_ids
        else {}
    )
    assignee_ids = {ticket.assignee_user_id for ticket in tickets if ticket.assignee_user_id}
    assignees = (
        {
            user_id: name
            for user_id, name in db.execute(
                select(User.id, User.name).where(User.id.in_(assignee_ids))
            ).all()
        }
        if assignee_ids
        else {}
    )
    document_ids = {ticket.document_id for ticket in tickets if ticket.document_id}
    documents = (
        {
            doc_id: title
            for doc_id, title in db.execute(
                select(Document.id, Document.title).where(Document.id.in_(document_ids))
            ).all()
        }
        if document_ids
        else {}
    )
    return orgs, assignees, documents


def _summary(
    ticket: SupportTicket,
    user: User,
    *,
    orgs: dict[str, Organization],
    assignees: dict[str, str],
    documents: dict[str, str],
) -> TicketResponse:
    org = orgs.get(ticket.organization_id)
    resolved = ticket.status == TicketStatus.resolved
    due = ticket.sla_due_at
    return TicketResponse(
        id=ticket.id,
        organization_id=ticket.organization_id,
        organization_name=org.name if org else None,
        organization_slug=org.slug if org else None,
        reference=ticket.reference,
        subject=ticket.subject,
        category=ticket.category,
        status=ticket.status,
        priority=ticket.priority,
        assignee_user_id=ticket.assignee_user_id,
        assignee_name=assignees.get(ticket.assignee_user_id) if ticket.assignee_user_id else None,
        document_id=ticket.document_id,
        document_title=documents.get(ticket.document_id) if ticket.document_id else None,
        tags=list(ticket.tags or []),
        sla_due_at=due,
        sla_label=platform_service.sla_label(due, resolved=resolved),
        sla_breached=bool(
            due is not None and not resolved and platform_service.as_aware(due) < now_utc()
        ),
        requester_name=ticket.requester_name,
        requester_email=ticket.requester_email,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        resolved_at=ticket.resolved_at,
        message_count=len(_visible_messages(ticket, user)),
    )


def _one_summary(db: Session, ticket: SupportTicket, user: User) -> TicketResponse:
    orgs, assignees, documents = _context(db, [ticket])
    return _summary(ticket, user, orgs=orgs, assignees=assignees, documents=documents)


def _detail(db: Session, ticket: SupportTicket, user: User) -> TicketDetailResponse:
    return TicketDetailResponse(
        **_one_summary(db, ticket, user).model_dump(),
        messages=[
            TicketMessageResponse.model_validate(message)
            for message in _visible_messages(ticket, user)
        ],
    )


def _owned(db: Session, ticket_id: str, user: User) -> SupportTicket:
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket or (not user.is_platform_admin and ticket.organization_id != user.organization_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


def _scoped_query(user: User, scope: str | None, organization_id: str | None):
    """Tenant callers are pinned to their own org; ``scope=all`` is platform-only."""
    query = select(SupportTicket)
    if user.is_platform_admin and scope == "all":
        if organization_id:
            query = query.where(SupportTicket.organization_id == organization_id)
        return query
    if scope == "all" and not user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Requires SaaS Super Admin permissions.",
        )
    return query.where(SupportTicket.organization_id == user.organization_id)


def _apply_filters(query, status_filter: str | None, priority: str | None, q: str | None, assignee: str | None):
    if status_filter == "open":
        query = query.where(SupportTicket.status.in_(OPEN_STATUSES))
    elif status_filter and status_filter != "all":
        query = query.where(SupportTicket.status == status_filter)
    if priority and priority != "all":
        query = query.where(SupportTicket.priority == priority)
    if assignee:
        query = query.where(SupportTicket.assignee_user_id == assignee)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(SupportTicket.subject).like(term),
                func.lower(SupportTicket.reference).like(term),
                func.lower(SupportTicket.requester_email).like(term),
            )
        )
    return query


def _counts(db: Session, base_query) -> TicketBucketCounts:
    ids = select(base_query.subquery().c.id)
    rows = db.execute(
        select(SupportTicket.status, func.count())
        .where(SupportTicket.id.in_(ids))
        .group_by(SupportTicket.status)
    ).all()
    by_status = {status_value: count for status_value, count in rows}
    return TicketBucketCounts(
        all=sum(by_status.values()),
        open=by_status.get(TicketStatus.open, 0),
        pending=by_status.get(TicketStatus.pending, 0),
        escalated=by_status.get(TicketStatus.escalated, 0),
        resolved=by_status.get(TicketStatus.resolved, 0),
    )


# --- Listing ---------------------------------------------------------------


@router.get("/tickets", response_model=list[TicketResponse])
def list_tickets(
    status_filter: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    q: str | None = Query(default=None),
    assignee_user_id: str | None = Query(default=None),
    scope: str | None = Query(default=None, description="'all' spans tenants (platform only)"),
    organization_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TicketResponse]:
    query = _apply_filters(
        _scoped_query(user, scope, organization_id), status_filter, priority, q, assignee_user_id
    )
    tickets = list(
        db.scalars(query.order_by(SupportTicket.updated_at.desc()).limit(limit).offset(offset))
    )
    orgs, assignees, documents = _context(db, tickets)
    return [
        _summary(ticket, user, orgs=orgs, assignees=assignees, documents=documents)
        for ticket in tickets
    ]


@router.get("/tickets/page", response_model=TicketPage)
def list_tickets_page(
    status_filter: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    q: str | None = Query(default=None),
    assignee_user_id: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketPage:
    """Same rows as ``/tickets`` plus the per-bucket counts the pills need.

    The counts ignore the status filter (the pills must keep showing the size
    of the other buckets) but honour every other filter.
    """
    scoped = _scoped_query(user, scope, organization_id)
    filtered = _apply_filters(scoped, status_filter, priority, q, assignee_user_id)
    total = db.scalar(select(func.count()).select_from(filtered.subquery())) or 0
    tickets = list(
        db.scalars(filtered.order_by(SupportTicket.updated_at.desc()).limit(limit).offset(offset))
    )
    orgs, assignees, documents = _context(db, tickets)
    return TicketPage(
        items=[
            _summary(ticket, user, orgs=orgs, assignees=assignees, documents=documents)
            for ticket in tickets
        ],
        total=total,
        counts=_counts(db, _apply_filters(scoped, None, priority, q, assignee_user_id)),
    )


# --- Create / read / reply -------------------------------------------------


@router.post("/tickets", response_model=TicketDetailResponse, status_code=201)
def create_ticket(
    payload: TicketCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketDetailResponse:
    if payload.document_id:
        document = db.get(Document, payload.document_id)
        if not document or document.organization_id != user.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    priority = payload.priority if payload.priority in set(TicketPriority) else TicketPriority.normal
    ticket = SupportTicket(
        organization_id=user.organization_id,
        reference=f"TKT-{token_hex(3).upper()}",
        subject=payload.subject,
        category=payload.category,
        priority=priority,
        status=TicketStatus.open,
        created_by_user_id=user.id,
        document_id=payload.document_id,
        tags=payload.tags or [],
        requester_name=user.name,
        requester_email=user.email,
        sla_due_at=platform_service.sla_due_at(priority),
    )
    db.add(ticket)
    db.flush()
    db.add(
        TicketMessage(
            ticket_id=ticket.id,
            author_user_id=user.id,
            author_name=user.name,
            body=payload.body,
            is_staff=False,
        )
    )
    db.commit()
    db.refresh(ticket)
    return _detail(db, ticket, user)


@router.get("/tickets/{ticket_id}", response_model=TicketDetailResponse)
def get_ticket(
    ticket_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> TicketDetailResponse:
    return _detail(db, _owned(db, ticket_id, user), user)


@router.post("/tickets/{ticket_id}/reply", response_model=TicketDetailResponse)
def reply(
    ticket_id: str,
    payload: TicketReply,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketDetailResponse:
    ticket = _owned(db, ticket_id, user)
    internal = bool(payload.internal)
    if internal and not user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only platform staff can add internal notes"
        )

    db.add(
        TicketMessage(
            ticket_id=ticket.id,
            author_user_id=user.id,
            author_name=user.name,
            body=payload.body,
            is_staff=user.is_platform_admin,
            is_internal=internal,
        )
    )
    # An internal note is a private annotation: it must not move the thread.
    if not internal:
        if ticket.status == TicketStatus.resolved:
            ticket.status = TicketStatus.open
            ticket.resolved_at = None
        elif ticket.status != TicketStatus.escalated:
            ticket.status = TicketStatus.pending if user.is_platform_admin else TicketStatus.open
        ticket.updated_at = now_utc()
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _detail(db, ticket, user)


@router.patch("/tickets/{ticket_id}", response_model=TicketDetailResponse)
def update_ticket(
    ticket_id: str,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketDetailResponse:
    ticket = _owned(db, ticket_id, user)
    if payload.status:
        if payload.status not in set(TicketStatus):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown ticket status")
        if payload.status == TicketStatus.pending and not user.is_platform_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only platform staff can put a ticket into pending",
            )
        ticket.status = payload.status
        ticket.resolved_at = now_utc() if payload.status == TicketStatus.resolved else None
    if payload.priority is not None:
        # Priority is a triage decision, so it belongs to platform staff.
        if not user.is_platform_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Only platform staff can change priority"
            )
        if payload.priority not in set(TicketPriority):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown priority")
        ticket.priority = payload.priority
        # Re-target the SLA from when the ticket was raised, not from now.
        ticket.sla_due_at = platform_service.sla_due_at(payload.priority, created_at=ticket.created_at)
    if payload.assignee_user_id is not None:
        if not user.is_platform_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Only platform staff can assign tickets"
            )
        if payload.assignee_user_id:
            agent = db.get(User, payload.assignee_user_id)
            if not agent or not agent.is_platform_admin:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee must be a platform agent"
                )
        ticket.assignee_user_id = payload.assignee_user_id or None
    if payload.tags is not None:
        ticket.tags = payload.tags
    ticket.updated_at = now_utc()
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _detail(db, ticket, user)


@router.post("/tickets/{ticket_id}/escalate", response_model=TicketDetailResponse)
def escalate_ticket(
    ticket_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketDetailResponse:
    """Either side can escalate; the SLA tightens to the urgent target."""
    ticket = _owned(db, ticket_id, user)
    if ticket.status == TicketStatus.resolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A resolved ticket cannot be escalated"
        )
    ticket.status = TicketStatus.escalated
    ticket.priority = TicketPriority.urgent
    ticket.sla_due_at = platform_service.sla_due_at(
        TicketPriority.urgent, created_at=ticket.created_at
    )
    ticket.updated_at = now_utc()
    db.add(ticket)
    db.add(
        TicketMessage(
            ticket_id=ticket.id,
            author_user_id=user.id,
            author_name=user.name,
            body=f"Ticket escalated by {user.name}.",
            is_staff=user.is_platform_admin,
        )
    )
    db.commit()
    db.refresh(ticket)
    return _detail(db, ticket, user)


# --- Platform queue --------------------------------------------------------


@router.get("/queue", response_model=list[PlatformTicketResponse])
def support_queue(
    status_filter: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    q: str | None = Query(default=None),
    assignee_user_id: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[PlatformTicketResponse]:
    """Every tenant's tickets, for the platform support queue."""
    query = select(SupportTicket)
    if organization_id:
        query = query.where(SupportTicket.organization_id == organization_id)
    query = _apply_filters(query, status_filter, priority, q, assignee_user_id)
    tickets = list(
        db.scalars(query.order_by(SupportTicket.updated_at.desc()).limit(limit).offset(offset))
    )
    orgs, assignees, documents = _context(db, tickets)
    return [
        PlatformTicketResponse(
            **_summary(ticket, admin, orgs=orgs, assignees=assignees, documents=documents).model_dump(
                exclude={"organization_name"}
            ),
            organization_name=orgs[ticket.organization_id].name
            if ticket.organization_id in orgs
            else "Unknown organization",
        )
        for ticket in tickets
    ]


@router.get("/agents", response_model=list[SupportAgent])
def list_agents(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[SupportAgent]:
    """The platform agent roster available as ticket assignees."""
    agents = list(
        db.scalars(select(User).where(User.is_platform_admin.is_(True)).order_by(User.name))
    )
    counts = {
        user_id: count
        for user_id, count in db.execute(
            select(SupportTicket.assignee_user_id, func.count())
            .where(SupportTicket.status.in_(OPEN_STATUSES))
            .group_by(SupportTicket.assignee_user_id)
        ).all()
        if user_id
    }
    return [
        SupportAgent(
            id=agent.id,
            name=agent.name,
            email=agent.email,
            specialty=(agent.preferences or {}).get("support_specialty")
            if isinstance(agent.preferences, dict)
            else None,
            open_ticket_count=counts.get(agent.id, 0),
        )
        for agent in agents
    ]


# --- Stats -----------------------------------------------------------------


def _first_response_minutes(db: Session, tickets: list[SupportTicket]) -> int | None:
    """Minutes from ticket creation to the first non-internal staff reply."""
    if not tickets:
        return None
    ids = [ticket.id for ticket in tickets]
    rows = db.execute(
        select(TicketMessage.ticket_id, func.min(TicketMessage.created_at))
        .where(
            TicketMessage.ticket_id.in_(ids),
            TicketMessage.is_staff.is_(True),
            TicketMessage.is_internal.is_(False),
        )
        .group_by(TicketMessage.ticket_id)
    ).all()
    first_by_ticket = dict(rows)
    deltas = []
    for ticket in tickets:
        first = first_by_ticket.get(ticket.id)
        if first is None:
            continue
        deltas.append(
            (
                platform_service.as_aware(first) - platform_service.as_aware(ticket.created_at)
            ).total_seconds()
            / 60
        )
    if not deltas:
        return None
    return int(sum(deltas) / len(deltas))


@router.get("/stats", response_model=TenantTicketStats)
def tenant_ticket_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TenantTicketStats:
    """Ticket stat tiles for the caller's own organization."""
    tickets = list(
        db.scalars(select(SupportTicket).where(SupportTicket.organization_id == user.organization_id))
    )
    cutoff = now_utc() - timedelta(days=90)
    resolved = [
        ticket
        for ticket in tickets
        if ticket.resolved_at is not None
        and platform_service.as_aware(ticket.resolved_at) >= cutoff
    ]
    resolution_minutes = []
    for ticket in resolved:
        resolution_minutes.append(
            (
                platform_service.as_aware(ticket.resolved_at)
                - platform_service.as_aware(ticket.created_at)
            ).total_seconds()
            / 60
        )

    return TenantTicketStats(
        open_count=sum(1 for ticket in tickets if ticket.status in OPEN_STATUSES),
        escalated_count=sum(1 for ticket in tickets if ticket.status == TicketStatus.escalated),
        avg_first_response_minutes=_first_response_minutes(db, tickets),
        sla_target_minutes=platform_service.SLA_TARGET_MINUTES[TicketPriority.urgent],
        resolved_90d=len(resolved),
        avg_resolution_minutes=int(sum(resolution_minutes) / len(resolution_minutes))
        if resolution_minutes
        else None,
    )


@router.get("/queue/stats", response_model=QueueTicketStats)
def queue_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> QueueTicketStats:
    tickets = list(db.scalars(select(SupportTicket)))
    open_tickets = [ticket for ticket in tickets if ticket.status in OPEN_STATUSES]
    soon = now_utc() + timedelta(hours=2)
    breaching = 0
    for ticket in open_tickets:
        due = platform_service.as_aware(ticket.sla_due_at)
        if due is None:
            continue
        if due <= soon:
            breaching += 1
    return QueueTicketStats(
        open_count=len(open_tickets),
        breaching_soon_count=breaching,
        first_response_minutes=_first_response_minutes(db, tickets),
        target_minutes=platform_service.SLA_TARGET_MINUTES[TicketPriority.urgent],
        # No CSAT survey exists yet; reported as absent rather than invented.
        csat_30d=None,
        csat_responses=0,
    )


@router.get("/quick-replies", response_model=list[QuickReply])
def quick_replies(user: User = Depends(get_current_user)) -> list[QuickReply]:
    """Canned responses, chosen by caller kind."""
    return QUICK_REPLIES_PLATFORM if user.is_platform_admin else QUICK_REPLIES_TENANT
