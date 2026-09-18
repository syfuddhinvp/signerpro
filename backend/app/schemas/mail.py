"""Schemas for the platform mail outbox and the compose form."""

from datetime import datetime

import base64
import binascii

from pydantic import BaseModel, EmailStr, Field, field_validator


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


#: The largest single attachment the compose form accepts, decoded. Base64 is
#: ~4/3 the size on the wire, so the request body stays comfortably inside the
#: app's own limit.
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
#: And the largest total, so fifty addressees cannot be sent 50MB each.
MAX_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024


class MailAttachment(BaseModel):
    """A file the admin attached, carried base64-encoded in the request."""

    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream", max_length=127)
    #: Base64, without a ``data:`` prefix -- the browser strips it.
    content: str = Field(min_length=1)

    @field_validator("filename")
    @classmethod
    def _plain_filename(cls, value: str) -> str:
        """No path in a filename: it is a label, never somewhere to write."""
        name = value.replace("\\", "/").rsplit("/", 1)[-1].strip()
        if not name or name in {".", ".."}:
            raise ValueError("Attachment needs a filename")
        return name

    def decoded(self) -> bytes:
        try:
            return base64.b64decode(self.content, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(f"{self.filename} is not valid base64") from exc


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
    #: Visible to every recipient, and copied on each addressee's message.
    cc: list[EmailStr] = Field(default_factory=list, max_length=50)
    #: Delivered but never named in the headers.
    bcc: list[EmailStr] = Field(default_factory=list, max_length=50)
    attachments: list[MailAttachment] = Field(default_factory=list, max_length=10)

    @field_validator("attachments")
    @classmethod
    def _within_size_limits(cls, value: list[MailAttachment]) -> list[MailAttachment]:
        total = 0
        for attachment in value:
            size = len(attachment.decoded())
            if size > MAX_ATTACHMENT_BYTES:
                raise ValueError(f"{attachment.filename} is larger than 5 MB")
            total += size
        if total > MAX_ATTACHMENTS_TOTAL_BYTES:
            raise ValueError("Attachments come to more than 10 MB in total")
        return value


class MailSendResult(BaseModel):
    """What the compose form gets back: one outbox row per addressee."""

    sent: int
    failed: int
    items: list[MailLogRow]
