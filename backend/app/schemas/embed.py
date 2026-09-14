from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.schemas.document import DocumentResponse
from app.schemas.field import FieldResponse
from app.schemas.recipient import RecipientResponse


class EmbedContactRef(BaseModel):
    id: str | None = None
    name: str | None = None
    email: EmailStr | None = None
    role: str | None = None


class EmbedDocumentRef(BaseModel):
    document_id: str | None = None
    template_id: str | None = None
    title: str | None = None
    file_url: str | None = None
    external_id: str | None = None


class EmbedSessionCreate(BaseModel):
    landing: Literal["builder", "routing", "signing"] = "builder"
    document: EmbedDocumentRef = Field(default_factory=EmbedDocumentRef)
    recipient_id: str | None = None
    contacts: list[EmbedContactRef] = Field(default_factory=list)
    return_url: str | None = Field(default=None, max_length=1024)
    ttl_minutes: int = Field(default=30, ge=1, le=1440)


class EmbedSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    url: str
    landing: str
    document_id: str | None = None
    external_id: str | None = None
    return_url: str | None = None
    allowed_origins: list[str] = Field(default_factory=list)
    contacts: list[Any] = Field(default_factory=list)
    expires_at: datetime
    consumed_at: datetime | None = None
    created_at: datetime
    expired: bool = False


class EmbedFrameAncestors(BaseModel):
    """The CSP source list the frontend middleware turns into a header."""

    frame_ancestors: list[str] = Field(default_factory=list)


class EmbedContextResponse(BaseModel):
    """Everything the framed surface needs, keyed by the embed token alone."""

    session: EmbedSessionResponse
    frame_ancestors: list[str] = Field(default_factory=list)
    document: DocumentResponse | None = None
    fields: list[FieldResponse] = Field(default_factory=list)
    recipients: list[RecipientResponse] = Field(default_factory=list)
