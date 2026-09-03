from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin, now_utc


class TicketStatus(StrEnum):
    open = "open"
    pending = "pending"
    escalated = "escalated"
    resolved = "resolved"


class TicketPriority(StrEnum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class SupportTicket(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A support request raised by a tenant and worked by platform staff."""

    __tablename__ = "support_tickets"
    __table_args__ = (
        Index("ix_support_tickets_organization_id", "organization_id"),
        Index("ix_support_tickets_status", "status"),
        # /support?assignee= filters on this column.
        Index("ix_support_tickets_assignee_user_id", "assignee_user_id"),
        # ON DELETE SET NULL when a document is purged.
        Index("ix_support_tickets_document_id", "document_id"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    reference: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=TicketStatus.open)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default=TicketPriority.normal)

    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assignee_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # SUP-2 / SUP-4
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requester_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requester_email: Mapped[str | None] = mapped_column(String(320), nullable=True)

    messages: Mapped[list["TicketMessage"]] = relationship(
        back_populates="ticket",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TicketMessage.created_at",
    )


class TicketMessage(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "ticket_messages"
    __table_args__ = (Index("ix_ticket_messages_ticket_id", "ticket_id"),)

    ticket_id: Mapped[str] = mapped_column(ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # True when written by platform staff rather than the tenant.
    is_staff: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Internal notes (SUP-3) are visible to platform callers only.
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    ticket: Mapped["SupportTicket"] = relationship(back_populates="messages")
