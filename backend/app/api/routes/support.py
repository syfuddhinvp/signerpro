from secrets import token_hex

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.core.database import get_db
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.support import SupportTicket, TicketMessage, TicketStatus
from app.models.user import User
from app.schemas.operations import (
    PlatformTicketResponse,
    TicketCreate,
    TicketDetailResponse,
    TicketMessageResponse,
    TicketReply,
    TicketResponse,
    TicketUpdate,
)

router = APIRouter(prefix="/api/support", tags=["support"])


def _summary(ticket: SupportTicket) -> TicketResponse:
    return TicketResponse(
        id=ticket.id,
        organization_id=ticket.organization_id,
        reference=ticket.reference,
        subject=ticket.subject,
        category=ticket.category,
        status=ticket.status,
        priority=ticket.priority,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        resolved_at=ticket.resolved_at,
        message_count=len(ticket.messages),
    )


def _detail(ticket: SupportTicket) -> TicketDetailResponse:
    return TicketDetailResponse(
        **_summary(ticket).model_dump(),
        messages=[TicketMessageResponse.model_validate(message) for message in ticket.messages],
    )


def _owned(db: Session, ticket_id: str, user: User) -> SupportTicket:
    ticket = db.get(SupportTicket, ticket_id)
    if not ticket or (not user.is_platform_admin and ticket.organization_id != user.organization_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


@router.get("/tickets", response_model=list[TicketResponse])
def list_tickets(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[TicketResponse]:
    query = select(SupportTicket).where(SupportTicket.organization_id == user.organization_id)
    if status_filter == "open":
        query = query.where(SupportTicket.status != TicketStatus.resolved)
    elif status_filter:
        query = query.where(SupportTicket.status == status_filter)
    tickets = db.scalars(query.order_by(SupportTicket.updated_at.desc())).all()
    return [_summary(ticket) for ticket in tickets]


@router.post("/tickets", response_model=TicketDetailResponse, status_code=201)
def create_ticket(
    payload: TicketCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketDetailResponse:
    ticket = SupportTicket(
        organization_id=user.organization_id,
        reference=f"TKT-{token_hex(3).upper()}",
        subject=payload.subject,
        category=payload.category,
        priority=payload.priority,
        status=TicketStatus.open,
        created_by_user_id=user.id,
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
    return _detail(ticket)


@router.get("/tickets/{ticket_id}", response_model=TicketDetailResponse)
def get_ticket(
    ticket_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> TicketDetailResponse:
    return _detail(_owned(db, ticket_id, user))


@router.post("/tickets/{ticket_id}/reply", response_model=TicketDetailResponse)
def reply(
    ticket_id: str,
    payload: TicketReply,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketDetailResponse:
    ticket = _owned(db, ticket_id, user)
    db.add(
        TicketMessage(
            ticket_id=ticket.id,
            author_user_id=user.id,
            author_name=user.name,
            body=payload.body,
            is_staff=user.is_platform_admin,
        )
    )
    # A reply from either side reopens a resolved thread.
    if ticket.status == TicketStatus.resolved:
        ticket.status = TicketStatus.open
        ticket.resolved_at = None
    else:
        ticket.status = TicketStatus.pending if user.is_platform_admin else TicketStatus.open
    ticket.updated_at = now_utc()
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _detail(ticket)


@router.patch("/tickets/{ticket_id}", response_model=TicketDetailResponse)
def update_ticket(
    ticket_id: str,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TicketDetailResponse:
    ticket = _owned(db, ticket_id, user)
    if payload.status:
        ticket.status = payload.status
        ticket.resolved_at = now_utc() if payload.status == TicketStatus.resolved else None
    if payload.priority:
        # Priority is a triage decision, so it belongs to platform staff.
        if not user.is_platform_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Only platform staff can change priority"
            )
        ticket.priority = payload.priority
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _detail(ticket)


@router.get("/queue", response_model=list[PlatformTicketResponse])
def support_queue(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[PlatformTicketResponse]:
    """Every tenant's tickets, for the platform support queue."""
    query = select(SupportTicket, Organization.name).join(
        Organization, Organization.id == SupportTicket.organization_id
    )
    if status_filter == "open":
        query = query.where(SupportTicket.status != TicketStatus.resolved)
    elif status_filter:
        query = query.where(SupportTicket.status == status_filter)
    rows = db.execute(query.order_by(SupportTicket.updated_at.desc())).all()
    return [
        PlatformTicketResponse(**_summary(ticket).model_dump(), organization_name=org_name)
        for ticket, org_name in rows
    ]
