"""Schemas for the platform mail outbox and the compose form."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class MailLogRow(BaseModel):
    """One message in the outbox.

    ``body_text`` / ``body_html`` are the *stored* copies: bearer links are
    masked and a message whose whole body is a secret carries none at all.
    """

    id: str
    created_at: datetime
    to_email: str
    from_email: str | None = None
    subject: str
    category: str
    status: str
    provider: str
    error: str | None = None
    body_text: str | None = None
    body_html: str | None = None
    #: The first line or so of the body, so the list can show a preview line
    #: without carrying whole messages. Present on the list *and* the detail.
    snippet: str | None = None
    document_id: str | None = None
    organization_id: str | None = None
    organization_name: str | None = None
    sent_by_email: str | None = None


class MailLogPage(BaseModel):
    items: list[MailLogRow]
    total: int
    #: The filter facets the console renders, so the UI never hard-codes them.
    categories: list[str] = []
    statuses: list[str] = []


class MailSendRequest(BaseModel):
    """A message a platform admin composed by hand.

    ``organization_id`` is the tenant the message is *about*: it files the
    outbox row under that tenant and sends through that tenant's own SMTP
    configuration when it has one. It is not required -- platform mail that
    belongs to no tenant is normal.
    """

    to: list[EmailStr] = Field(min_length=1, max_length=50)
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=20000)
    #: When false the body is sent as plain text only. When true it is also
    #: rendered into the standard branded shell as the HTML part.
    send_html: bool = True
    organization_id: str | None = None


class MailSendResult(BaseModel):
    """What the compose form gets back: one outbox row per addressee."""

    sent: int
    failed: int
    items: list[MailLogRow]
